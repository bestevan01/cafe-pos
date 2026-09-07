const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken } = require('../middlewares/auth');
const debugInfo = require('../utils/debugInfo');
const crypto = require('crypto');
const r2 = require('../config/r2');

// 직원용 위생 점검 API. 로그인만 하면 누구나 쓴다(역할 무관).
// 항목 편집·기록 조회는 관리자 전용이라 hygieneAdmin.routes.js에 따로 있다.
router.use(authenticateToken);

// 오늘 점검할 체크리스트. 은퇴한 항목(is_active=0)은 내려주지 않는다.
router.get('/items', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, label, category, sort_order
             FROM hygiene_items
             WHERE is_active = 1
             ORDER BY sort_order, id`,
        );
        res.json(rows);
    } catch (/** @type {any} */ err) {
        console.error('[🔥 GET /api/hygiene/items 에러]', err);
        res.status(500).json({
            success: false,
            message: '위생 점검 항목을 불러오지 못했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

// 오늘 점검 기록. 없으면 check: null — 클라이언트는 이걸로 '작성' / '수정' 모드를 정한다.
router.get('/today', async (req, res) => {
    try {
        const [[check]] = await pool.query(
            `SELECT id, DATE_FORMAT(check_date, '%Y-%m-%d') AS check_date, checked_at,
                    checked_by_id, checked_by_name, memo
             FROM hygiene_checks
             WHERE check_date = CURDATE()`,
        );
        if (!check) return res.json({ check: null });
        const [results] = await pool.query(
            `SELECT item_id, item_label, item_category, sort_order, status, note
             FROM hygiene_check_results
             WHERE check_id = ?
             ORDER BY sort_order, id`,
            [check.id],
        );
        const [photos] = await pool.query(
            "SELECT id, item_id FROM hygiene_check_photos WHERE check_id = ? AND status = 'ready' ORDER BY id",
            [check.id],
        );
        res.json({ check: { ...check, results, photos } });
    } catch (/** @type {any} */ err) {
        console.error('[🔥 GET /api/hygiene/today 에러]', err);
        res.status(500).json({
            success: false,
            message: '오늘 점검 기록을 확인하지 못했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

const STATUSES = ['ok', 'fail', 'na'];

/**
 * 제출된 결과를 검증하고, 저장할 행으로 만든다.
 * 문구·분류·순서는 요청 본문이 아니라 DB의 항목에서 가져온다 —
 * 클라이언트가 보낸 문구를 그대로 믿으면 기록을 위조할 수 있다.
 * @param {any[]} items 현재 활성 항목
 * @param {any} body
 * @returns {{error: string}|{rows: any[][]}}
 */
function buildResultRows(items, body) {
    const input = Array.isArray(body.results) ? body.results : [];
    /** @type {Map<number, any>} */
    const byId = new Map(input.map((/** @type {any} */ r) => [Number(r.item_id), r]));

    /** @type {any[][]} */
    const rows = [];
    for (const item of items) {
        const r = byId.get(item.id);
        if (!r || !STATUSES.includes(r.status)) {
            return { error: `"${item.label}" 항목을 확인해주세요.` };
        }
        const note =
            String(r.note ?? '')
                .trim()
                .slice(0, 500) || null;
        // 미흡은 왜 미흡인지 남겨야 나중에 조치를 확인할 수 있다.
        if (r.status === 'fail' && !note) {
            return { error: `"${item.label}"은(는) 미흡 사유를 적어주세요.` };
        }
        rows.push([item.id, item.label, item.category, item.sort_order, r.status, note]);
    }
    return { rows };
}

/**
 * 제출에 딸려온 사진들을 이 점검에 붙인다.
 * 본인이 올렸고, 업로드가 확인됐고, 아직 다른 점검에 붙지 않은 것만 받는다 —
 * 남의 사진 id를 적어 보내 남의 기록에 끼워넣는 것을 막는다.
 * @param {any} conn @param {number} checkId @param {any} body @param {string} userId
 */
async function attachPhotos(conn, checkId, body, userId) {
    const ids = (Array.isArray(body.results) ? body.results : [])
        .flatMap((/** @type {any} */ r) => (Array.isArray(r.photo_ids) ? r.photo_ids : []))
        .map(Number)
        .filter(Number.isInteger);
    if (ids.length === 0) return;
    await conn.query(
        `UPDATE hygiene_check_photos
         SET check_id = ?
         WHERE id IN (?)
           AND uploaded_by = ?
           AND status = 'ready'
           AND (check_id IS NULL OR check_id = ?)`,
        [checkId, ids, userId, checkId],
    );
}

/** 활성 항목을 가져온다. 하나도 없으면 점검 자체가 성립하지 않는다. */
async function loadActiveItems() {
    const [items] = await pool.query(
        'SELECT id, label, category, sort_order FROM hygiene_items WHERE is_active = 1 ORDER BY sort_order, id',
    );
    return items;
}

// 오늘치 제출. 하루 1건이라 check_date에 UNIQUE가 걸려 있다.
router.post('/checks', async (req, res) => {
    const items = await loadActiveItems().catch(() => null);
    if (!items) return res.status(500).json({ success: false, message: '항목을 불러오지 못했습니다.' });
    if (items.length === 0) {
        return res.status(400).json({ success: false, message: '점검 항목이 없습니다. 관리자에게 문의하세요.' });
    }

    const built = buildResultRows(items, req.body);
    if ('error' in built) return res.status(400).json({ success: false, message: built.error });
    const memo =
        String(req.body.memo ?? '')
            .trim()
            .slice(0, 500) || null;

    const conn = await pool.getConnection();
    try {
        // 점검과 결과가 따로 저장되면 항목 없는 빈 기록이 남는다. 한 트랜잭션으로 묶는다.
        await conn.beginTransaction();
        const [ins] = await conn.query(
            'INSERT INTO hygiene_checks (check_date, checked_by_id, checked_by_name, memo) VALUES (CURDATE(), ?, ?, ?)',
            [req.user.id, req.user.name, memo],
        );
        await conn.query(
            'INSERT INTO hygiene_check_results (check_id, item_id, item_label, item_category, sort_order, status, note) VALUES ?',
            [built.rows.map((r) => [ins.insertId, ...r])],
        );
        await attachPhotos(conn, ins.insertId, req.body, req.user.id);
        await conn.commit();
        res.json({ success: true, id: ins.insertId });
    } catch (/** @type {any} */ err) {
        await conn.rollback();
        // 두 사람이 동시에 제출하면 UNIQUE가 막는다. 이미 있다고 알려주고 클라이언트가 다시 불러오게 한다.
        if (err && err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: '오늘 점검이 이미 제출되었습니다.' });
        }
        console.error('[🔥 POST /api/hygiene/checks 에러]', err);
        res.status(500).json({ success: false, message: '점검 제출에 실패했습니다.', debug_info: debugInfo(err) });
    } finally {
        conn.release();
    }
});

// 당일 수정. 지난 날짜는 고치지 못한다 — 감사 기록이라 사후 수정이 되면 의미가 없다.
// checked_by와 checked_at은 그대로 둔다(원래 누가 언제 점검했는지가 기록의 핵심).
router.put('/checks/:id', async (req, res) => {
    const items = await loadActiveItems().catch(() => null);
    if (!items) return res.status(500).json({ success: false, message: '항목을 불러오지 못했습니다.' });

    const built = buildResultRows(items, req.body);
    if ('error' in built) return res.status(400).json({ success: false, message: built.error });
    const memo =
        String(req.body.memo ?? '')
            .trim()
            .slice(0, 500) || null;

    const conn = await pool.getConnection();
    try {
        const [[row]] = await conn.query('SELECT id FROM hygiene_checks WHERE id = ? AND check_date = CURDATE()', [
            req.params.id,
        ]);
        if (!row) {
            return res.status(403).json({ success: false, message: '오늘 점검만 수정할 수 있습니다.' });
        }

        await conn.beginTransaction();
        await conn.query('UPDATE hygiene_checks SET memo = ? WHERE id = ?', [memo, row.id]);
        // 항목이 추가·은퇴했을 수 있어 부분 수정 대신 통째로 다시 쓴다.
        await conn.query('DELETE FROM hygiene_check_results WHERE check_id = ?', [row.id]);
        await conn.query(
            'INSERT INTO hygiene_check_results (check_id, item_id, item_label, item_category, sort_order, status, note) VALUES ?',
            [built.rows.map((r) => [row.id, ...r])],
        );
        await attachPhotos(conn, row.id, req.body, req.user.id);
        await conn.commit();
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        await conn.rollback();
        console.error('[🔥 PUT /api/hygiene/checks/:id 에러]', err);
        res.status(500).json({ success: false, message: '점검 수정에 실패했습니다.', debug_info: debugInfo(err) });
    } finally {
        conn.release();
    }
});

// ============================================================
// 사진 첨부 (Cloudflare R2)
// ============================================================

// 지금은 압축도 크기 제한도 걸지 않는다. 한 달간 실제 데이터를 쌓아보고 판단하기로 했다.
// 대신 bytes / content_type / 해상도를 남겨 그때 근거로 쓴다.
const PHOTO_RETENTION_DAYS = 730; // R2 Lifecycle 규칙과 같은 값이어야 한다

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/** 확장자는 브라우저가 준 MIME에서만 정한다. 파일명은 신뢰하지 않는다(경로 조작 방지). */
const extOf = (/** @type {string} */ type) =>
    ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' })[
        type
    ] ?? 'bin';

// 업로드할 자리를 잡고 서명 URL을 내준다.
router.post('/uploads/sign', async (req, res) => {
    if (!r2.isConfigured) {
        return res.status(503).json({ success: false, message: '사진 저장소가 설정되지 않았습니다.' });
    }
    const contentType = String(req.body.content_type ?? '');
    if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
        return res.status(400).json({ success: false, message: '이미지 파일만 올릴 수 있습니다.' });
    }
    const itemId = Number(req.body.item_id);
    if (!Number.isInteger(itemId)) {
        return res.status(400).json({ success: false, message: '점검 항목이 지정되지 않았습니다.' });
    }

    // 키에 날짜를 넣어 나중에 사람이 보기 쉽게 한다. 파일명은 UUID라 충돌·추측이 불가능하다.
    const now = new Date();
    const ym = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
    const key = `hygiene/${ym}/${crypto.randomUUID()}.${extOf(contentType)}`;

    try {
        // R2에 올리기 전에 행을 먼저 만든다 — 업로드 후 확인 요청이 끊겨도 흔적이 남는다.
        const [ins] = await pool.query(
            'INSERT INTO hygiene_check_photos (item_id, r2_key, status, uploaded_by) VALUES (?, ?, ?, ?)',
            [itemId, key, 'pending', req.user.id],
        );
        const url = await r2.signUpload(key, contentType);
        res.json({ success: true, photo_id: ins.insertId, upload_url: url });
    } catch (/** @type {any} */ err) {
        console.error('[🔥 POST /api/hygiene/uploads/sign 에러]', err);
        res.status(500).json({ success: false, message: '업로드 준비에 실패했습니다.', debug_info: debugInfo(err) });
    }
});

// 업로드가 끝났다는 보고. 실제로 올라왔는지 R2에 직접 확인한다.
router.post('/uploads/:id/confirm', async (req, res) => {
    if (!r2.isConfigured)
        return res.status(503).json({ success: false, message: '사진 저장소가 설정되지 않았습니다.' });
    try {
        const [[photo]] = await pool.query('SELECT id, r2_key, uploaded_by FROM hygiene_check_photos WHERE id = ?', [
            req.params.id,
        ]);
        if (!photo) return res.status(404).json({ success: false, message: '사진 정보를 찾을 수 없습니다.' });
        if (photo.uploaded_by !== req.user.id) {
            return res.status(403).json({ success: false, message: '본인이 올린 사진만 확인할 수 있습니다.' });
        }

        // 크기·타입은 브라우저 말이 아니라 R2에서 읽는다.
        const { bytes, contentType } = await r2.head(photo.r2_key);
        const w = Number(req.body.width) || null;
        const h = Number(req.body.height) || null;
        await pool.query(
            "UPDATE hygiene_check_photos SET status = 'ready', bytes = ?, content_type = ?, width = ?, height = ? WHERE id = ?",
            [bytes, contentType, w, h, photo.id],
        );
        res.json({ success: true, bytes, content_type: contentType });
    } catch (/** @type {any} */ err) {
        // 업로드가 실제로는 실패한 경우 HeadObject가 404를 낸다.
        if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) {
            return res.status(400).json({ success: false, message: '업로드가 완료되지 않았습니다.' });
        }
        console.error('[🔥 POST /api/hygiene/uploads/:id/confirm 에러]', err);
        res.status(500).json({ success: false, message: '업로드 확인에 실패했습니다.', debug_info: debugInfo(err) });
    }
});

// 사진 삭제. 잘못 붙인 사진을 그냥 버리면 R2에 고아 객체가 남는다(2년 뒤 Lifecycle이 지우긴 한다).
// 본인이 올렸고 아직 아무 점검에 안 붙었거나, 붙었더라도 '오늘' 점검인 것만 지운다 —
// 지난 기록의 사진을 지우는 건 감사 기록을 고치는 것이라 막는다.
router.delete('/uploads/:id', async (req, res) => {
    if (!r2.isConfigured)
        return res.status(503).json({ success: false, message: '사진 저장소가 설정되지 않았습니다.' });
    try {
        const [[photo]] = await pool.query(
            `SELECT p.id, p.r2_key, p.uploaded_by, p.check_id, c.check_date = CURDATE() AS is_today
             FROM hygiene_check_photos p
                      LEFT JOIN hygiene_checks c ON c.id = p.check_id
             WHERE p.id = ?`,
            [req.params.id],
        );
        if (!photo) return res.status(404).json({ success: false, message: '사진을 찾을 수 없습니다.' });
        if (photo.uploaded_by !== req.user.id) {
            return res.status(403).json({ success: false, message: '본인이 올린 사진만 지울 수 있습니다.' });
        }
        if (photo.check_id !== null && !photo.is_today) {
            return res.status(403).json({ success: false, message: '오늘 점검의 사진만 지울 수 있습니다.' });
        }

        // R2를 먼저 지운다. 여기서 실패하면 DB 행이 남아 다시 시도할 수 있다.
        // 순서를 반대로 하면 R2에만 파일이 남고 아무도 모른다.
        await r2.remove(photo.r2_key);
        await pool.query('DELETE FROM hygiene_check_photos WHERE id = ?', [photo.id]);
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        console.error('[🔥 DELETE /api/hygiene/uploads/:id 에러]', err);
        res.status(500).json({ success: false, message: '사진을 지우지 못했습니다.', debug_info: debugInfo(err) });
    }
});

/**
 * 사진 조회용 서명 URL. 관리자·직원 공통으로 쓴다.
 * 보관 기간이 지난 사진은 R2에서 이미 지워졌으므로 URL을 내주지 않고 만료로 알린다.
 */
router.get('/photos/:id/url', async (req, res) => {
    if (!r2.isConfigured)
        return res.status(503).json({ success: false, message: '사진 저장소가 설정되지 않았습니다.' });
    try {
        const [[photo]] = await pool.query(
            `SELECT id, r2_key, status,
                    DATEDIFF(CURDATE(), DATE(created_at)) AS age_days
             FROM hygiene_check_photos
             WHERE id = ?`,
            [req.params.id],
        );
        if (!photo || photo.status !== 'ready') {
            return res.status(404).json({ success: false, message: '사진을 찾을 수 없습니다.' });
        }
        if (photo.age_days >= PHOTO_RETENTION_DAYS) {
            return res.status(410).json({ success: false, message: '보관 기간(2년)이 지나 삭제된 사진입니다.' });
        }
        res.json({ success: true, url: await r2.signDownload(photo.r2_key) });
    } catch (/** @type {any} */ err) {
        console.error('[🔥 GET /api/hygiene/photos/:id/url 에러]', err);
        res.status(500).json({ success: false, message: '사진 주소를 만들지 못했습니다.', debug_info: debugInfo(err) });
    }
});

module.exports = router;
