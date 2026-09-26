const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken, requireAdmin } = require('../middlewares/auth');
const debugInfo = require('../utils/debugInfo');
const { kstDate } = require('../utils/kstDate');
const { latestStatus } = require('../services/inventoryStatus');
const { inventorySlots } = require('../utils/inventorySlots');

// 재고 조사 기록 조회. 관리자 전용.
router.use(authenticateToken, requireAdmin);

// slot은 'HHMM'이라 문자열 정렬이 곧 시간 순이다. 회차가 몇 개든 ORDER BY slot 하나로 끝난다.

/**
 * 가장 최근 조사 기준의 현재 재고.
 *
 * '주문 필요'는 여기서 서버가 판단한다. 화면마다 따로 계산하면 기준이 갈라진다.
 * 판단에 쓰는 기준치는 품목의 현재 값이 아니라 그 조사에 복사해 둔 값이다 —
 * 관리자가 기준을 바꿔도 지난 기록의 판단이 소급해 달라지면 안 된다.
 */
router.get('/latest', async (req, res) => {
    try {
        // 판단은 services/inventoryStatus가 한다. 알림도 같은 함수를 쓴다 —
        // 각자 계산하면 화면에는 '주문 필요'가 떴는데 알림은 안 오는 일이 생긴다.
        const status = await latestStatus();
        res.json({ count: status.count, rows: status.rows, low_count: status.low.length });
    } catch (/** @type {any} */ err) {
        console.error('[🔥 GET /api/admin/inventory/latest 에러]', err);
        res.status(500).json({
            success: false,
            message: '재고 현황을 불러오지 못했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

/** 'YYYY-MM-DD'만 통과시킨다. 아니면 null → 호출부에서 기본값으로 대체. */
const asDate = (/** @type {any} */ v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);

// 구간별 조사 기록. 수치까지 한 번에 실어 보낸다 — 회차마다 상세를 부르면 왕복이 많아진다.
router.get('/counts', async (req, res) => {
    const to = asDate(req.query.to) ?? kstDate();
    const from = asDate(req.query.from) ?? kstDate(-13);
    try {
        const [counts] = await pool.query(
            `SELECT c.id, DATE_FORMAT(c.count_date, '%Y-%m-%d') AS count_date, c.slot, c.slot_label,
                    c.counted_at, c.counted_by_name, c.memo
             FROM inventory_counts c
             WHERE c.count_date BETWEEN ? AND ?
             ORDER BY c.count_date DESC, c.slot ASC`,
            [from, to],
        );
        if (counts.length === 0) return res.json({ from, to, counts: [] });

        const [items] = await pool.query(
            `SELECT i.count_id, i.item_id, i.item_label, i.measure_mode, i.count_unit,
                    i.count_per_pack, i.base_unit, i.tare_g, i.low_threshold, i.quantity, i.spare_count, i.sort_order
             FROM inventory_count_items i
                      JOIN inventory_counts c ON c.id = i.count_id
             WHERE c.count_date BETWEEN ? AND ?
             ORDER BY i.sort_order, i.id`,
            [from, to],
        );
        /** @type {Map<number, any[]>} */
        const byCount = new Map();
        for (const it of items) {
            const quantity = Number(it.quantity);
            const threshold = it.low_threshold === null ? null : Number(it.low_threshold);
            const row = {
                ...it,
                quantity,
                low_threshold: threshold,
                is_low: threshold !== null && quantity <= threshold,
            };
            const list = byCount.get(it.count_id);
            if (list) list.push(row);
            else byCount.set(it.count_id, [row]);
        }

        res.json({
            from,
            to,
            counts: counts.map((/** @type {any} */ c) => {
                const rows = byCount.get(c.id) ?? [];
                return { ...c, items: rows, low_count: rows.filter((r) => r.is_low).length };
            }),
        });
    } catch (/** @type {any} */ err) {
        console.error('[🔥 GET /api/admin/inventory/counts 에러]', err);
        res.status(500).json({
            success: false,
            message: '재고 조사 기록을 불러오지 못했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

// ============================================================
// 조사 회차 (inventory_slots) — 위생 점검과 같은 공통 모듈을 쓴다(utils/slotSchedule.js).
// ============================================================
router.use('/slots', inventorySlots.router);

// ============================================================
// 조사 품목 (inventory_items)
// ============================================================
// 원가·순익의 원재료(ingredients)와 별개다. 두 매장 모두 원가 분석을 사실상 쓰지 않고,
// 매입가는 같은 규격이어도 살 때마다 달라져 유지가 부담이라는 피드백을 받았다.
// 매일 쓰는 재고가 안 쓰는 기능의 데이터 상태에 묶이면 안 되어 따로 뒀다.
const MEASURE_MODES = ['pack', 'each', 'weight'];

router.get('/items', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, name, measure_mode, count_unit, count_per_pack, base_unit,
                    tare_g, low_threshold, is_active, sort_order
             FROM inventory_items
             ORDER BY sort_order, name`,
        );
        res.json(rows);
    } catch (/** @type {any} */ err) {
        console.error('[🔥 GET /api/admin/inventory/items 에러]', err);
        res.status(500).json({ success: false, message: '품목을 불러오지 못했습니다.', debug_info: debugInfo(err) });
    }
});

/**
 * 고칠 값을 검증해 수정 목록으로 만든다.
 * @param {any} body
 * @returns {{error: string}|{fields: string[], values: any[]}}
 */
function buildItemUpdate(body) {
    /** @type {string[]} */
    const fields = [];
    /** @type {any[]} */
    const values = [];

    if (body.name !== undefined) {
        const name = String(body.name).trim().slice(0, 100);
        if (!name) return { error: '품목 이름을 입력해주세요.' };
        fields.push('name = ?');
        values.push(name);
    }
    if (body.measure_mode !== undefined) {
        if (!MEASURE_MODES.includes(body.measure_mode)) return { error: '세는 방법이 올바르지 않습니다.' };
        fields.push('measure_mode = ?');
        values.push(body.measure_mode);
    }
    for (const key of ['count_unit', 'base_unit']) {
        if (body[key] === undefined) continue;
        const v = String(body[key]).trim().slice(0, 10);
        if (!v) return { error: '단위를 입력해주세요.' };
        fields.push(`${key} = ?`);
        values.push(v);
    }
    if (body.is_active !== undefined) {
        fields.push('is_active = ?');
        values.push(body.is_active ? 1 : 0);
    }
    // 비우면 NULL(기준 없음)로 둔다. 통 무게와 주문 기준은 '아직 모른다'가 정상 상태다.
    /** @type {[string, (v: number) => boolean, string][]} */
    const numbers = [
        ['count_per_pack', (v) => v > 0, '한 팩의 양은 0보다 커야 합니다.'],
        ['tare_g', (v) => v >= 0, '통 무게는 0 이상이어야 합니다.'],
        ['low_threshold', (v) => v >= 0, '주문 기준은 0 이상이어야 합니다.'],
        ['sort_order', (v) => Number.isInteger(v), '표시 순서는 정수여야 합니다.'],
    ];
    for (const [key, ok, message] of numbers) {
        if (body[key] === undefined) continue;
        // 비우면 '모른다/일정하지 않다'는 뜻으로 받는다.
        // count_per_pack도 비울 수 있다 — 빨대처럼 한 봉에 든 개수가 100개일 때도 200개일 때도
        // 있는 물건은 환산 자체가 거짓말이 된다. 없는 편이 틀린 숫자보다 낫다.
        if (body[key] === null || body[key] === '') {
            fields.push(`${key} = ?`);
            values.push(null);
            continue;
        }
        const v = Number(body[key]);
        if (!Number.isFinite(v) || !ok(v)) return { error: message };
        fields.push(`${key} = ?`);
        values.push(v);
    }
    return { fields, values };
}

router.post('/items', async (req, res) => {
    const built = buildItemUpdate(req.body);
    if ('error' in built) return res.status(400).json({ success: false, message: built.error });
    if (!String(req.body.name ?? '').trim()) {
        return res.status(400).json({ success: false, message: '품목 이름을 입력해주세요.' });
    }
    try {
        const [[max]] = await pool.query('SELECT COALESCE(MAX(sort_order), 0) AS n FROM inventory_items');
        const [r] = await pool.query(`INSERT INTO inventory_items (name, sort_order) VALUES (?, ?)`, [
            String(req.body.name).trim().slice(0, 100),
            max.n + 1,
        ]);
        if (built.fields.length > 0) {
            await pool.query(`UPDATE inventory_items SET ${built.fields.join(', ')} WHERE id = ?`, [
                ...built.values,
                r.insertId,
            ]);
        }
        res.json({ success: true, id: r.insertId });
    } catch (/** @type {any} */ err) {
        console.error('[🔥 POST /api/admin/inventory/items 에러]', err);
        res.status(500).json({ success: false, message: '품목을 추가하지 못했습니다.', debug_info: debugInfo(err) });
    }
});

router.patch('/items/:id', async (req, res) => {
    const built = buildItemUpdate(req.body);
    if ('error' in built) return res.status(400).json({ success: false, message: built.error });
    if (built.fields.length === 0) return res.json({ success: true });
    try {
        await pool.query(`UPDATE inventory_items SET ${built.fields.join(', ')} WHERE id = ?`, [
            ...built.values,
            req.params.id,
        ]);
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        console.error(`[🔥 PATCH /api/admin/inventory/items/${req.params.id} 에러]`, err);
        res.status(500).json({ success: false, message: '품목을 수정하지 못했습니다.', debug_info: debugInfo(err) });
    }
});

// ============================================================
// 세는 단위 이름 (inventory_units)
// ============================================================
// 개수(1줄=80개)는 여기 두지 않는다. 같은 '줄'이라도 품목마다 개수가 달라서(컵홀더 기본 80,
// 병역 20, 1L 100) 이름에 개수를 묶으면 오히려 안 맞는다. 여기는 이름만 모은다.
router.get('/units', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, name, sort_order FROM inventory_units ORDER BY sort_order, id');
        res.json(rows);
    } catch (/** @type {any} */ err) {
        console.error('[🔥 GET /api/admin/inventory/units 에러]', err);
        res.status(500).json({
            success: false,
            message: '단위 목록을 불러오지 못했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

router.post('/units', async (req, res) => {
    const name = String(req.body.name ?? '')
        .trim()
        .slice(0, 10);
    if (!name) return res.status(400).json({ success: false, message: '단위 이름을 입력해주세요.' });
    try {
        const [[max]] = await pool.query('SELECT COALESCE(MAX(sort_order), 0) AS n FROM inventory_units');
        const [r] = await pool.query('INSERT INTO inventory_units (name, sort_order) VALUES (?, ?)', [name, max.n + 1]);
        res.json({ success: true, id: r.insertId });
    } catch (/** @type {any} */ err) {
        if (err && err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: '이미 있는 단위입니다.' });
        }
        console.error('[🔥 POST /api/admin/inventory/units 에러]', err);
        res.status(500).json({ success: false, message: '단위를 추가하지 못했습니다.', debug_info: debugInfo(err) });
    }
});

// 쓰고 있는 단위는 지우지 못한다. 지우면 그 품목의 단위가 빈칸이 되어 조사 화면이 어그러진다.
router.delete('/units/:id', async (req, res) => {
    try {
        const [[unit]] = await pool.query('SELECT name FROM inventory_units WHERE id = ?', [req.params.id]);
        if (!unit) return res.status(404).json({ success: false, message: '단위를 찾을 수 없습니다.' });

        const [[used]] = await pool.query('SELECT COUNT(*) AS n FROM inventory_items WHERE count_unit = ?', [
            unit.name,
        ]);
        if (used.n > 0) {
            return res.status(409).json({
                success: false,
                message: `"${unit.name}"을(를) 쓰는 품목이 ${used.n}개 있습니다. 먼저 품목의 단위를 바꿔주세요.`,
            });
        }
        await pool.query('DELETE FROM inventory_units WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        console.error('[🔥 DELETE /api/admin/inventory/units/:id 에러]', err);
        res.status(500).json({ success: false, message: '단위를 지우지 못했습니다.', debug_info: debugInfo(err) });
    }
});

// ============================================================
// 조사 화면 표시 순서
// ============================================================
// 직원이 세는 차례대로 놓을 수 있어야 한다. 창고를 훑는 동선과 화면 순서가 다르면
// 위아래로 오가며 찾게 된다. 위생 점검 체크리스트와 같은 방식.
router.put('/items/order', async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
    if (!ids || ids.length === 0) return res.status(400).json({ success: false, message: '순서 정보가 없습니다.' });

    const conn = await pool.getConnection();
    try {
        // 한 품목이라도 실패하면 순서가 절반만 바뀐 채 남는다. 트랜잭션으로 묶는다.
        await conn.beginTransaction();
        for (let i = 0; i < ids.length; i++) {
            await conn.query('UPDATE inventory_items SET sort_order = ? WHERE id = ?', [i + 1, ids[i]]);
        }
        await conn.commit();
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        await conn.rollback();
        console.error('[🔥 PUT /api/admin/inventory/items/order 에러]', err);
        res.status(500).json({ success: false, message: '순서 저장에 실패했습니다.', debug_info: debugInfo(err) });
    } finally {
        conn.release();
    }
});

module.exports = router;
