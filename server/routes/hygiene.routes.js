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

/** 점검 칸. 오전·오후 두 번 하도록 운영 지침이 정해져 있다. */
const SLOTS = ['am', 'pm'];

/**
 * 오전과 오후를 가르는 시각. 말 그대로 정오를 경계로 한다.
 *
 * 두 매장 모두 오픈이 9시라 오전 점검은 오전 중에 끝나고, 오후 점검은 16시(본부동)·17시(은혜관)라
 * 정오 전에 할 일이 없다. 그래서 정오로 갈라도 두 점검이 섞이지 않는다.
 *
 * 감수하는 것 하나: 오전 점검이 정오를 넘겨 제출되면 오후 칸으로 기록된다. 그러면 진짜 오후
 * 점검 때 같은 칸이라 새 기록이 아니라 수정이 되어, 그날 오전이 빈 것으로 남는다.
 * 오픈이 9시인데 3시간 넘게 밀리는 경우라 드물다고 보고 정오를 택했다.
 * 그런 일이 잦아지면 이 값을 늦추는 것을 검토할 것.
 *
 * ⚠️ server.js의 backfill 쿼리와 마이그레이션 012도 같은 값을 쓴다. 바꾸면 함께 바꿔야
 * 과거 기록과 앞으로 쌓일 기록의 기준이 어긋나지 않는다.
 */
const PM_FROM_HOUR = 12;

/**
 * 지금이 어느 칸인지 서버 시계로 정한다.
 *
 * 클라이언트가 고르게 하지 않는 이유:
 *  - 칸과 실제 제출 시각(checked_at)이 어긋날 수 없다. 둘 다 같은 시계에서 나온다.
 *    (칸을 사람이 고르던 때 '오전 · 16:29' 같은 앞뒤 안 맞는 기록이 실제로 남았다)
 *  - 기기 시계가 틀어져 있어도 기록은 서버 기준으로 일관된다.
 *  - 직원이 누를 것이 하나 줄어든다. 바쁜 시간대에 고민거리를 만들지 않는다.
 */
function currentSlot() {
    return new Date().getHours() >= PM_FROM_HOUR ? 'pm' : 'am';
}

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
        // 하루 2회가 되면서 '오늘의 기록'이 하나가 아니다. 두 칸을 모두 내려보내
        // 클라이언트가 어느 칸이 비었는지, 오전을 누가 했는지 알 수 있게 한다.
        const [rows] = await pool.query(
            `SELECT id, slot, DATE_FORMAT(check_date, '%Y-%m-%d') AS check_date, checked_at,
                    checked_by_id, checked_by_name, memo
             FROM hygiene_checks
             WHERE check_date = CURDATE()`,
        );
        /** @type {Record<string, any>} */
        const bySlot = { am: null, pm: null };
        for (const r of rows) bySlot[r.slot] = r;

        for (const slot of SLOTS) {
            const check = bySlot[slot];
            if (!check) continue;
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
            bySlot[slot] = { ...check, results, photos };
        }
        // 지금 채울 칸도 함께 알려준다. 클라이언트가 자기 시계로 따로 판단하면
        // 서버가 실제로 기록할 칸과 어긋날 수 있다.
        res.json({ slots: bySlot, current_slot: currentSlot() });
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
            'INSERT INTO hygiene_checks (check_date, slot, checked_by_id, checked_by_name, memo) VALUES (CURDATE(), ?, ?, ?, ?)',
            // 클라이언트가 보낸 칸은 쓰지 않는다. 서버 시계로 정해야 checked_at과 항상 맞는다.
            [currentSlot(), req.user.id, req.user.name, memo],
        );
        await conn.query(
            'INSERT INTO hygiene_check_results (check_id, item_id, item_label, item_category, sort_order, status, note) VALUES ?',
            [built.rows.map((r) => [ins.insertId, ...r])],
        );
        await attachPhotos(conn, ins.insertId, req.body, req.user.id);
        await conn.commit();
        // 관리자의 점검 기록 화면이 새로고침 없이 받아보도록 알린다.
        req.app.get('io').emit('hygiene_updated');
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
/**
 * 수정 전후를 비교해 무엇이 바뀌었는지 뽑는다.
 *
 * 결과를 통째로 지우고 다시 쓰기 때문에, 지우기 전에 비교해 두지 않으면 이전 답변이 사라진다.
 * 바뀐 게 없으면 null을 돌려준다 — 아무것도 안 고치고 저장만 누른 것까지 이력에 쌓으면
 * 정작 중요한 변경이 묻힌다.
 *
 * 사유와 특이사항은 '바뀌었다'가 아니라 바뀌기 전후의 글을 그대로 담는다.
 * 상태는 '미흡 → 양호'로 남는데 글만 '변경됨'으로 뭉개면, 무엇이 어떻게 고쳐졌는지 알 수 없어
 * 감사 기록으로 쓸모가 없다. 결과 행은 수정할 때 통째로 지워지므로 여기 남기지 않으면 사라진다.
 * 둘 다 500자 상한이라 원문을 그대로 담아도 부담이 없다.
 *
 * @param {{item_id: number|null, item_label: string, status: string, note: string|null}[]} before
 * @param {any[][]} after  buildResultRows가 만든 행 [item_id, label, category, sort_order, status, note]
 * @param {string|null} memoBefore
 * @param {string|null} memoAfter
 * @param {{added: number, removed: number}} photos
 * @returns {string|null} 이력에 저장할 JSON. 변경이 없으면 null
 */
function diffCheck(before, after, memoBefore, memoAfter, photos) {
    const prev = new Map(before.map((r) => [r.item_id, r]));
    /** @type {{label: string, from: string, to: string, noteFrom: string, noteTo: string}[]} */
    const items = [];
    for (const [itemId, label, , , status, note] of after) {
        const old = prev.get(itemId);
        if (!old) continue; // 새로 생긴 항목은 '변경'이 아니다
        const noteFrom = old.note ?? '';
        const noteTo = note ?? '';
        if (old.status !== status || noteFrom !== noteTo) {
            items.push({ label: old.item_label || label, from: old.status, to: status, noteFrom, noteTo });
        }
    }
    const memoFrom = memoBefore ?? '';
    const memoTo = memoAfter ?? '';
    const memoChanged = memoFrom !== memoTo;
    const photoChanged = photos.added > 0 || photos.removed > 0;
    if (items.length === 0 && !memoChanged && !photoChanged) return null;
    return JSON.stringify({ items, memoChanged, memoFrom, memoTo, photos });
}

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
        const [[row]] = await conn.query(
            'SELECT id, memo FROM hygiene_checks WHERE id = ? AND check_date = CURDATE()',
            [req.params.id],
        );
        if (!row) {
            return res.status(403).json({ success: false, message: '오늘 점검만 수정할 수 있습니다.' });
        }

        // 지우기 전에 이전 상태를 읽어 둔다. 지운 뒤에는 비교할 대상이 없다.
        const [before] = await conn.query(
            'SELECT item_id, item_label, status, note FROM hygiene_check_results WHERE check_id = ?',
            [row.id],
        );
        const [beforePhotos] = await conn.query(
            "SELECT id FROM hygiene_check_photos WHERE check_id = ? AND status = 'ready'",
            [row.id],
        );

        await conn.beginTransaction();
        await conn.query('UPDATE hygiene_checks SET memo = ? WHERE id = ?', [memo, row.id]);
        // 항목이 추가·은퇴했을 수 있어 부분 수정 대신 통째로 다시 쓴다.
        await conn.query('DELETE FROM hygiene_check_results WHERE check_id = ?', [row.id]);
        await conn.query(
            'INSERT INTO hygiene_check_results (check_id, item_id, item_label, item_category, sort_order, status, note) VALUES ?',
            [built.rows.map((r) => [row.id, ...r])],
        );
        await attachPhotos(conn, row.id, req.body, req.user.id);

        // 사진이 늘어난 것은 붙인 뒤에 세야 실제 결과가 반영된다.
        // 줄어든 것은 여기서 셀 수 없다 — ✕를 누른 순간 DELETE /uploads/:id가 이미 처리했고,
        // 그 시점에 이력도 함께 남겼다. 그래서 여기서는 추가분만 본다.
        const [afterPhotos] = await conn.query(
            "SELECT id FROM hygiene_check_photos WHERE check_id = ? AND status = 'ready'",
            [row.id],
        );
        const beforeIds = new Set(beforePhotos.map((/** @type {any} */ p) => p.id));
        const photoDiff = {
            added: afterPhotos.filter((/** @type {any} */ p) => !beforeIds.has(p.id)).length,
            removed: 0,
        };

        // 무엇이 바뀌었는지 남긴다. 고치는 것은 막지 않되 고친 사실은 남아야 한다.
        const changes = diffCheck(before, built.rows, row.memo, memo, photoDiff);
        if (changes) {
            await conn.query(
                'INSERT INTO hygiene_check_edits (check_id, edited_by_id, edited_by_name, changes) VALUES (?, ?, ?, ?)',
                [row.id, req.user.id, req.user.name, changes],
            );
        }

        await conn.commit();
        // 관리자의 점검 기록 화면이 새로고침 없이 받아보도록 알린다.
        req.app.get('io').emit('hygiene_updated');
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

// 사진 삭제. 어디에 붙어 있느냐에 따라 두 가지로 갈린다.
//
//  1) 아직 아무 점검에도 안 붙은 사진 → 진짜로 지운다.
//     제출 전에 잘못 올린 파일이라 남길 가치가 없고, 그냥 두면 R2에 고아 객체가 쌓인다.
//  2) 이미 제출된 오늘 점검에 붙은 사진 → 지운 표시만 하고 파일은 남긴다.
//     감사 기록의 일부라서다. 미흡 항목의 증거 사진을 지우고 상태를 '양호'로 고치면
//     기록상 아무 일도 없었던 것이 된다. 관리자 화면에는 '삭제됨 · 누가 · 언제'로 계속 보인다.
//     자세한 배경은 migrations/014_hygiene_photo_soft_delete.sql 참고.
//
// 어느 쪽이든 본인이 올린 사진만, 그리고 붙었다면 '오늘' 점검인 것만 건드릴 수 있다 —
// 지난 기록의 사진을 지우는 건 감사 기록을 고치는 것이라 막는다.
router.delete('/uploads/:id', async (req, res) => {
    if (!r2.isConfigured)
        return res.status(503).json({ success: false, message: '사진 저장소가 설정되지 않았습니다.' });
    try {
        const [[photo]] = await pool.query(
            `SELECT p.id, p.r2_key, p.uploaded_by, p.check_id, p.item_id, p.status,
                    c.check_date = CURDATE() AS is_today
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

        if (photo.check_id === null) {
            // R2를 먼저 지운다. 여기서 실패하면 DB 행이 남아 다시 시도할 수 있다.
            // 순서를 반대로 하면 R2에만 파일이 남고 아무도 모른다.
            await r2.remove(photo.r2_key);
            await pool.query('DELETE FROM hygiene_check_photos WHERE id = ?', [photo.id]);
            return res.json({ success: true });
        }

        // 이미 지운 사진을 또 지워도 이력이 두 번 쌓이지 않게 한다.
        if (photo.status === 'removed') return res.json({ success: true });

        // 어느 항목의 사진이었는지는 결과 행에 복사된 문구로 남긴다.
        // hygiene_items를 보면 안 된다 — 관리자가 항목을 고쳐도 그날 기록은 그대로여야 한다.
        const [[hit]] = await pool.query(
            'SELECT item_label FROM hygiene_check_results WHERE check_id = ? AND item_id = ? LIMIT 1',
            [photo.check_id, photo.item_id],
        );

        const conn = await pool.getConnection();
        try {
            // 표시를 바꾸는 것과 이력을 남기는 것은 하나여야 한다.
            // 표시만 바뀌고 이력이 없으면 소리 없이 사라진 사진이 된다.
            await conn.beginTransaction();
            await conn.query(
                `UPDATE hygiene_check_photos
                 SET status = 'removed', removed_at = NOW(), removed_by_id = ?, removed_by_name = ?
                 WHERE id = ?`,
                [req.user.id, req.user.name, photo.id],
            );
            await conn.query(
                'INSERT INTO hygiene_check_edits (check_id, edited_by_id, edited_by_name, changes) VALUES (?, ?, ?, ?)',
                [
                    photo.check_id,
                    req.user.id,
                    req.user.name,
                    // 저장을 누를 때가 아니라 지금 남긴다. 사진은 ✕를 누른 순간 이미 지워지므로,
                    // 저장까지 미루면 고치다 말고 나간 경우에 삭제만 되고 기록이 없다.
                    JSON.stringify({
                        items: [],
                        memoChanged: false,
                        memoFrom: '',
                        memoTo: '',
                        photos: { added: 0, removed: 1 },
                        removedPhotos: [{ id: photo.id, label: hit ? hit.item_label : null }],
                    }),
                ],
            );
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }

        req.app.get('io').emit('hygiene_updated');
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
        // 'removed'도 내준다. 지운 사진을 관리자가 확인할 수 있어야 삭제 기록이 의미를 갖는다.
        // 아직 업로드가 끝나지 않은 'pending'은 R2에 파일이 없을 수 있어 제외한다.
        if (!photo || (photo.status !== 'ready' && photo.status !== 'removed')) {
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
