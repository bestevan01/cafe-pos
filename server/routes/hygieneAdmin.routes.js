const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken, requireAdmin } = require('../middlewares/auth');
const debugInfo = require('../utils/debugInfo');
const { HYGIENE_CATEGORIES } = require('../utils/hygieneCategories');

// 위생점검 관리자 API — 체크리스트 항목 편집. 이 라우터는 전부 관리자 전용.
router.use(authenticateToken, requireAdmin);

const MAX_LABEL = 200;

/** 목록에 없는 분류가 오면 '기타'로 떨어뜨린다. 클라이언트가 드롭다운이라 정상 경로에서는 발생하지 않는다. */
const normalizeCategory = (/** @type {any} */ c) => (HYGIENE_CATEGORIES.includes(String(c)) ? String(c) : '기타');

/** 앞뒤 공백을 털고 길이를 자른다. 빈 문자열이면 null. */
const clean = (/** @type {any} */ v, /** @type {number} */ max) => {
    const s = String(v ?? '').trim();
    return s ? s.slice(0, max) : null;
};

// 편집 화면은 은퇴한 항목도 봐야 한다(되살릴 수 있어야 하므로).
router.get('/items', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, label, category, sort_order, is_active
             FROM hygiene_items
             ORDER BY is_active DESC, sort_order, id`,
        );
        res.json(rows);
    } catch (/** @type {any} */ err) {
        console.error('[🔥 GET /api/admin/hygiene/items 에러]', err);
        res.status(500).json({ success: false, message: '항목을 불러오지 못했습니다.', debug_info: debugInfo(err) });
    }
});

router.post('/items', async (req, res) => {
    const label = clean(req.body.label, MAX_LABEL);
    if (!label) return res.status(400).json({ success: false, message: '점검 문구를 입력하세요.' });
    const category = normalizeCategory(req.body.category);
    try {
        // 새 항목은 항상 맨 뒤로. 순서를 비워두면 0이 몰려 정렬이 뒤섞인다.
        const [[{ next }]] = await pool.query('SELECT IFNULL(MAX(sort_order), 0) + 1 AS next FROM hygiene_items');
        const [result] = await pool.query('INSERT INTO hygiene_items (label, category, sort_order) VALUES (?, ?, ?)', [
            label,
            category,
            next,
        ]);
        res.json({ success: true, id: result.insertId });
    } catch (/** @type {any} */ err) {
        console.error('[🔥 POST /api/admin/hygiene/items 에러]', err);
        res.status(500).json({ success: false, message: '항목 추가에 실패했습니다.', debug_info: debugInfo(err) });
    }
});

router.patch('/items/:id', async (req, res) => {
    const { id } = req.params;
    /** @type {string[]} */ const sets = [];
    /** @type {any[]} */ const vals = [];

    if (req.body.label !== undefined) {
        const label = clean(req.body.label, MAX_LABEL);
        if (!label) return res.status(400).json({ success: false, message: '점검 문구를 입력하세요.' });
        sets.push('label = ?');
        vals.push(label);
    }
    if (req.body.category !== undefined) {
        sets.push('category = ?');
        vals.push(normalizeCategory(req.body.category));
    }
    if (req.body.is_active !== undefined) {
        sets.push('is_active = ?');
        vals.push(req.body.is_active ? 1 : 0);
    }
    if (sets.length === 0) return res.status(400).json({ success: false, message: '변경할 내용이 없습니다.' });

    try {
        await pool.query(`UPDATE hygiene_items SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        console.error('[🔥 PATCH /api/admin/hygiene/items/:id 에러]', err);
        res.status(500).json({ success: false, message: '항목 수정에 실패했습니다.', debug_info: debugInfo(err) });
    }
});

// 순서 일괄 저장. [id, id, ...] 순서대로 sort_order를 다시 매긴다.
router.put('/items/order', async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
    if (!ids || ids.length === 0) return res.status(400).json({ success: false, message: '순서 정보가 없습니다.' });

    const conn = await pool.getConnection();
    try {
        // 한 항목이라도 실패하면 순서가 절반만 바뀐 채 남는다. 트랜잭션으로 묶는다.
        await conn.beginTransaction();
        for (let i = 0; i < ids.length; i++) {
            await conn.query('UPDATE hygiene_items SET sort_order = ? WHERE id = ?', [i + 1, ids[i]]);
        }
        await conn.commit();
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        await conn.rollback();
        console.error('[🔥 PUT /api/admin/hygiene/items/order 에러]', err);
        res.status(500).json({ success: false, message: '순서 저장에 실패했습니다.', debug_info: debugInfo(err) });
    } finally {
        conn.release();
    }
});

// 삭제는 소프트 삭제(is_active = 0)다.
// 진짜 지우면 과거 기록의 item_id가 NULL이 되어 "이 항목의 지난 6개월 추이" 같은 조회가 끊긴다.
// 기록에 문구 자체는 복사돼 있으므로 보고서가 깨지지는 않지만, 항목 단위 추적을 잃는다.
router.delete('/items/:id', async (req, res) => {
    try {
        await pool.query('UPDATE hygiene_items SET is_active = 0 WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        console.error('[🔥 DELETE /api/admin/hygiene/items/:id 에러]', err);
        res.status(500).json({ success: false, message: '항목 삭제에 실패했습니다.', debug_info: debugInfo(err) });
    }
});

// ============================================================
// 점검 기록 조회
// ============================================================

/** 'YYYY-MM-DD'만 통과시킨다. 아니면 null → 호출부에서 기본값으로 대체. */
const asDate = (/** @type {any} */ v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);

router.get('/checks', async (req, res) => {
    // 기본 구간은 최근 30일. 범위를 안 주면 전체를 긁어와 점점 느려진다.
    const to = asDate(req.query.to) ?? new Date().toISOString().slice(0, 10);
    const from = asDate(req.query.from) ?? new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
    try {
        const [rows] = await pool.query(
            // check_date는 '순간'이 아니라 달력 날짜다. Date 객체로 내보내면 JSON에서 UTC 순간이 되고,
            // 보는 쪽 타임존에 따라 하루 어긋난다. 문자열로 고정해 타임존을 아예 개입시키지 않는다.
            `SELECT c.id,
                    DATE_FORMAT(c.check_date, '%Y-%m-%d') AS check_date,
                    c.checked_at,
                    c.checked_by_name,
                    c.memo,
                    COUNT(r.id)                              AS total,
                    SUM(r.status = 'ok')                     AS ok_count,
                    SUM(r.status = 'fail')                   AS fail_count,
                    SUM(r.status = 'na')                     AS na_count
             FROM hygiene_checks c
                      LEFT JOIN hygiene_check_results r ON r.check_id = c.id
             WHERE c.check_date BETWEEN ? AND ?
             GROUP BY c.id
             ORDER BY c.check_date DESC`,
            [from, to],
        );
        // 미흡 내역은 보고서에 반드시 들어간다. 기록마다 상세를 따로 부르면 한 달치에 수십 번 왕복하므로
        // 구간 전체의 미흡만 한 번에 가져와 붙인다(미흡은 건수가 적어 통째로 실어도 가볍다).
        const [fails] = await pool.query(
            `SELECT r.check_id, r.item_label, r.item_category, r.note
             FROM hygiene_check_results r
                      JOIN hygiene_checks c ON c.id = r.check_id
             WHERE c.check_date BETWEEN ? AND ?
               AND r.status = 'fail'
             ORDER BY c.check_date, r.sort_order, r.id`,
            [from, to],
        );
        /** @type {Map<number, any[]>} */
        const byCheck = new Map();
        for (const f of fails) {
            const list = byCheck.get(f.check_id);
            if (list) list.push(f);
            else byCheck.set(f.check_id, [f]);
        }

        res.json({
            from,
            to,
            checks: rows.map((/** @type {any} */ r) => ({ ...r, fails: byCheck.get(r.id) ?? [] })),
        });
    } catch (/** @type {any} */ err) {
        console.error('[🔥 GET /api/admin/hygiene/checks 에러]', err);
        res.status(500).json({
            success: false,
            message: '점검 기록을 불러오지 못했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

router.get('/checks/:id', async (req, res) => {
    try {
        const [[check]] = await pool.query(
            `SELECT id, DATE_FORMAT(check_date, '%Y-%m-%d') AS check_date, checked_at,
                    checked_by_id, checked_by_name, memo
             FROM hygiene_checks
             WHERE id = ?`,
            [req.params.id],
        );
        if (!check) return res.status(404).json({ success: false, message: '해당 점검 기록이 없습니다.' });
        // 항목 문구는 결과 행에 복사돼 있다. hygiene_items를 조인하지 않는 이유가 이것 —
        // 그날 점검한 문구 그대로 보여야 하고, 이후 항목이 바뀌어도 영향받으면 안 된다.
        const [results] = await pool.query(
            `SELECT id, item_id, item_label, item_category, sort_order, status, note
             FROM hygiene_check_results
             WHERE check_id = ?
             ORDER BY sort_order, id`,
            [req.params.id],
        );
        // 사진은 목록이 아니라 상세에서만 붙인다. 목록에 실으면 안 볼 기록의 사진까지 조회하게 된다.
        const [photos] = await pool.query(
            "SELECT id, item_id, bytes, content_type, width, height FROM hygiene_check_photos WHERE check_id = ? AND status = 'ready' ORDER BY id",
            [req.params.id],
        );
        res.json({ ...check, results, photos });
    } catch (/** @type {any} */ err) {
        console.error('[🔥 GET /api/admin/hygiene/checks/:id 에러]', err);
        res.status(500).json({
            success: false,
            message: '점검 기록을 불러오지 못했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

module.exports = router;
