const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken } = require('../middlewares/auth');
const debugInfo = require('../utils/debugInfo');
const { loadSlots, slotSql, currentSlot } = require('../utils/inventorySlots');
const { fireAlert } = require('../utils/alerts');
const { latestStatus } = require('../services/inventoryStatus');

// 직원용 재고 조사 API. 로그인만 하면 누구나 쓴다(역할 무관).
// 품목 설정과 기록 조회는 관리자 전용이라 inventoryAdmin.routes.js에 따로 있다.
router.use(authenticateToken);

const MEASURE_MODES = ['pack', 'each', 'weight'];

/** 품목에서 매번 읽는 칼럼. 기록에 복사해 둘 값들이라 한곳에 모아 둔다. */
const ITEM_COLUMNS = `id, name, measure_mode, count_unit, count_per_pack, base_unit,
                      tare_g, low_threshold, sort_order`;

/**
 * 조사할 품목.
 *
 * 환산값(count_per_pack)을 함께 보낸다 — 화면에서 '13봉 = 650개'를 바로 보여주면
 * 숫자를 잘못 적었을 때 알아차리기 쉽다.
 */
async function loadCountItems() {
    const [rows] = await pool.query(
        `SELECT ${ITEM_COLUMNS} FROM inventory_items WHERE is_active = 1 ORDER BY sort_order, name`,
    );
    return rows;
}

// 오늘의 세 회차와 지금 채울 회차.
router.get('/today', async (req, res) => {
    try {
        const items = await loadCountItems();
        const now = await currentSlot();
        const slotKeys = now.slots.map((s) => s.slot_key);

        const [counts] = await pool.query(
            `SELECT id, slot, slot_label, DATE_FORMAT(count_date, '%Y-%m-%d') AS count_date, counted_at,
                    counted_by_id, counted_by_name, memo
             FROM inventory_counts
             WHERE count_date = CURDATE()`,
        );
        /** @type {Record<string, any>} */
        const bySlot = {};
        for (const key of slotKeys) bySlot[key] = null;
        for (const c of counts) bySlot[c.slot] = c;

        // 이미 낸 회차는 적었던 수치까지 함께 보낸다(수정 모드로 열기 위해).
        for (const key of slotKeys) {
            if (!bySlot[key]) continue;
            const [rows] = await pool.query(
                `SELECT item_id, item_label, quantity, spare_count, count_unit, measure_mode
                 FROM inventory_count_items
                 WHERE count_id = ?
                 ORDER BY sort_order, id`,
                [bySlot[key].id],
            );
            bySlot[key] = { ...bySlot[key], items: rows };
        }

        // 직전 회차의 수치도 보낸다. 같은 품목이 얼마였는지 옆에 보이면 자리를 헷갈리지 않는다.
        // slot은 'HHMM'이라 문자열 정렬이 곧 시간 순이다(FIELD 목록이 필요 없다).
        const [[prev]] = await pool.query(
            `SELECT id, DATE_FORMAT(count_date, '%Y-%m-%d') AS count_date, slot, slot_label
             FROM inventory_counts
             ORDER BY count_date DESC, slot DESC
             LIMIT 1`,
        );
        /** @type {Record<string, {quantity: number, spare_count: number}>} */
        const previous = {};
        if (prev) {
            const [rows] = await pool.query(
                'SELECT item_id, quantity, spare_count FROM inventory_count_items WHERE count_id = ?',
                [prev.id],
            );
            for (const r of rows) {
                if (r.item_id != null) {
                    previous[r.item_id] = { quantity: Number(r.quantity), spare_count: Number(r.spare_count) };
                }
            }
        }

        res.json({
            items,
            slots: bySlot,
            slot_list: now.slots,
            current_slot: now.key,
            current_slot_label: now.label,
            // 회차를 정해 둔 매장인데 오늘은 적용되는 회차가 없다(미운영일). 화면이 알려준다.
            off_day: now.offDay,
            previous,
            previous_at: prev ?? null,
        });
    } catch (/** @type {any} */ err) {
        console.error('[🔥 GET /api/inventory/today 에러]', err);
        res.status(500).json({
            success: false,
            message: '재고 조사 정보를 불러오지 못했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

/**
 * 제출된 수치를 저장할 행으로 만든다.
 * 품목 정보는 요청 본문이 아니라 DB에서 읽는다 — 클라이언트가 보낸 환산값을 믿으면
 * 기록을 위조할 수 있고, 관리자가 방금 고친 값과도 어긋난다.
 * @param {any[]} items 조사 대상 품목
 * @param {any} body
 * @returns {{error: string}|{rows: any[][]}}
 */
function buildCountRows(items, body) {
    const input = Array.isArray(body.items) ? body.items : [];
    /** @type {Map<number, any>} */
    const byId = new Map(input.map((/** @type {any} */ r) => [Number(r.item_id), r]));

    /** @type {any[][]} */
    const rows = [];
    for (const item of items) {
        const raw = byId.get(item.id);
        const quantity = Number(raw?.quantity);
        if (raw === undefined || !Number.isFinite(quantity) || quantity < 0) {
            return { error: `"${item.name}" 수량을 확인해주세요.` };
        }
        // 저울 품목만 미개봉 여분을 따로 받는다. 저울에는 쓰고 있는 통 하나만 올리기 때문이다.
        // 봉지·개수로 세는 품목은 애초에 안 뜯은 것까지 함께 세므로 여분이라는 개념이 없다.
        let spare = 0;
        if (item.measure_mode === 'weight') {
            spare = Number(raw?.spare_count ?? 0);
            if (!Number.isFinite(spare) || spare < 0) {
                return { error: `"${item.name}" 미개봉 수량을 확인해주세요.` };
            }
        }
        rows.push([
            item.id,
            item.name,
            item.measure_mode,
            item.count_unit,
            item.count_per_pack,
            item.base_unit,
            item.tare_g,
            item.low_threshold ?? null,
            quantity,
            spare,
            item.sort_order,
        ]);
    }
    return { rows };
}

/**
 * 방금 낸 조사에 기준 미달 품목이 있으면 관리자에게 알린다.
 *
 * 같은 회차를 여러 번 고쳐도 내용이 같으면 다시 울리지 않는다(dedupe) —
 * 숫자 하나 고칠 때마다 알림이 가면 사람은 곧 무시하게 된다.
 * 실패해도 제출 자체는 이미 끝났으므로 조용히 삼킨다.
 * @param {import('socket.io').Server} io
 */
async function notifyIfLow(io) {
    try {
        const status = await latestStatus();
        if (!status.count || status.low.length === 0) return;
        const signature = [
            status.count.count_date,
            status.count.slot,
            ...status.low.map((/** @type {any} */ r) => r.item_id).sort(),
        ].join(':');
        await fireAlert(io, 'inventory_low', { dedupeKey: signature });
    } catch (/** @type {any} */ err) {
        console.error('[🔥 재고 조사 직후 알림 실패]', err.message);
    }
}

const COUNT_ITEM_COLUMNS = `(count_id, item_id, item_label, measure_mode, count_unit,
                             count_per_pack, base_unit, tare_g, low_threshold, quantity, spare_count, sort_order)`;

// 회차 제출. (날짜, 회차)에 UNIQUE가 걸려 있어 같은 회차를 두 번 내면 409로 막힌다.
router.post('/counts', async (req, res) => {
    const items = await loadCountItems().catch(() => null);
    if (!items) return res.status(500).json({ success: false, message: '품목을 불러오지 못했습니다.' });
    if (items.length === 0) {
        return res.status(400).json({ success: false, message: '조사할 품목이 없습니다. 관리자에게 문의하세요.' });
    }

    const built = buildCountRows(items, req.body);
    if ('error' in built) return res.status(400).json({ success: false, message: built.error });
    const memo =
        String(req.body.memo ?? '')
            .trim()
            .slice(0, 500) || null;

    const conn = await pool.getConnection();
    try {
        // 회차 목록은 관리자가 정한다. 경계는 이웃한 시각의 가운데로 자동 계산된다.
        const slots = await loadSlots();
        const labelOf = Object.fromEntries(slots.map((sl) => [sl.slot_key, sl.label]));

        await conn.beginTransaction();
        // 회차는 CURDATE()와 같은 문장에서 정한다. 경계 시각에 걸쳐도 날짜·회차·시각이 어긋나지 않는다.
        // 이름은 스냅샷으로 함께 남긴다 — 나중에 관리자가 시각을 바꿔도 지난 기록은 그대로여야 한다.
        const [ins] = await conn.query(
            `INSERT INTO inventory_counts (count_date, slot, slot_label, counted_by_id, counted_by_name, memo)
             VALUES (CURDATE(), ${slotSql(slots)}, NULL, ?, ?, ?)`,
            [req.user.id, req.user.name, memo],
        );
        await conn.query(`INSERT INTO inventory_count_items ${COUNT_ITEM_COLUMNS} VALUES ?`, [
            built.rows.map((r) => [ins.insertId, ...r]),
        ]);
        const [[saved]] = await conn.query('SELECT slot FROM inventory_counts WHERE id = ?', [ins.insertId]);
        await conn.query('UPDATE inventory_counts SET slot_label = ? WHERE id = ?', [
            labelOf[saved.slot] ?? saved.slot,
            ins.insertId,
        ]);
        await conn.commit();

        req.app.get('io').emit('inventory_updated');
        // 조사를 마친 순간 기준 미달 품목이 있으면 바로 알린다. 정해진 시각까지 기다리면
        // 이미 주문할 타이밍을 놓친 뒤일 수 있다.
        void notifyIfLow(req.app.get('io'));
        res.json({ success: true, id: ins.insertId, slot: saved.slot, slot_label: labelOf[saved.slot] });
    } catch (/** @type {any} */ err) {
        await conn.rollback();
        if (err && err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: '이 회차 조사가 이미 제출되었습니다.' });
        }
        console.error('[🔥 POST /api/inventory/counts 에러]', err);
        res.status(500).json({ success: false, message: '재고 조사 제출에 실패했습니다.', debug_info: debugInfo(err) });
    } finally {
        conn.release();
    }
});

// 당일 수정. 지난 날짜는 고치지 못한다 — 재고 기록도 사후에 바뀌면 추이를 믿을 수 없다.
// counted_by와 counted_at은 그대로 둔다(원래 누가 언제 셌는지가 기록의 핵심).
router.put('/counts/:id', async (req, res) => {
    const items = await loadCountItems().catch(() => null);
    if (!items) return res.status(500).json({ success: false, message: '품목을 불러오지 못했습니다.' });

    const built = buildCountRows(items, req.body);
    if ('error' in built) return res.status(400).json({ success: false, message: built.error });
    const memo =
        String(req.body.memo ?? '')
            .trim()
            .slice(0, 500) || null;

    const conn = await pool.getConnection();
    try {
        const [[row]] = await conn.query('SELECT id FROM inventory_counts WHERE id = ? AND count_date = CURDATE()', [
            req.params.id,
        ]);
        if (!row) {
            return res.status(403).json({ success: false, message: '오늘 조사만 수정할 수 있습니다.' });
        }

        await conn.beginTransaction();
        await conn.query('UPDATE inventory_counts SET memo = ? WHERE id = ?', [memo, row.id]);
        // 품목이 추가·은퇴했을 수 있어 부분 수정 대신 통째로 다시 쓴다.
        await conn.query('DELETE FROM inventory_count_items WHERE count_id = ?', [row.id]);
        await conn.query(`INSERT INTO inventory_count_items ${COUNT_ITEM_COLUMNS} VALUES ?`, [
            built.rows.map((r) => [row.id, ...r]),
        ]);
        await conn.commit();

        req.app.get('io').emit('inventory_updated');
        void notifyIfLow(req.app.get('io'));
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        await conn.rollback();
        console.error(`[🔥 PUT /api/inventory/counts/${req.params.id} 에러]`, err);
        res.status(500).json({ success: false, message: '재고 조사 수정에 실패했습니다.', debug_info: debugInfo(err) });
    } finally {
        conn.release();
    }
});

module.exports = router;
module.exports.MEASURE_MODES = MEASURE_MODES;
