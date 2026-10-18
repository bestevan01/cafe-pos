const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken, requireAdmin } = require('../middlewares/auth');
const debugInfo = require('../utils/debugInfo');

// 요약 통계: 행을 받지 않고 서버에서 SUM 집계 → 데이터가 아무리 쌓여도 즉시.
// 날짜는 DATE()·YEAR()·MONTH()를 씌우지 않고 created_at 범위로 건다. 컬럼에 함수를 씌우면
// idx_orders_created_at을 못 타고 orders 전체를 읽는다.
router.get('/summary', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [[today]] = await pool.query(
            'SELECT IFNULL(SUM(total_price),0) AS s FROM orders WHERE is_paid=1 AND created_at >= CURDATE() AND created_at < CURDATE() + INTERVAL 1 DAY',
        );
        const [[month]] = await pool.query(
            'SELECT IFNULL(SUM(total_price),0) AS s FROM orders WHERE is_paid=1 AND created_at >= CURDATE() - INTERVAL (DAY(CURDATE()) - 1) DAY AND created_at < LAST_DAY(CURDATE()) + INTERVAL 1 DAY',
        );
        const [[total]] = await pool.query(
            'SELECT IFNULL(SUM(total_price),0) AS s, COUNT(*) AS c FROM orders WHERE is_paid=1',
        );
        const [periods] = await pool.query(
            'SELECT DISTINCT YEAR(created_at) AS year, MONTH(created_at) AS month FROM orders WHERE is_paid=1 ORDER BY year DESC, month DESC',
        );
        res.json({
            today: Number(today.s),
            month: Number(month.s),
            total: Number(total.s),
            totalCount: Number(total.c),
            periods: periods.map((/** @type {any} */ p) => ({ year: Number(p.year), month: Number(p.month) })),
        });
    } catch (/** @type {any} */ err) {
        console.error('[🔥 GET /api/admin/sales/summary 에러]', err);
        res.status(500).json({
            success: false,
            message: '매출 요약을 불러오지 못했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

// 상세 내역: 연+월 단위로만 조회 (전체 로딩 방지). 미지정 시 이번 달.
router.get('', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const year = parseInt(String(req.query.year), 10);
        const month = parseInt(String(req.query.month), 10);
        let sql;
        /** @type {any[]} */
        let params;
        if (year && month) {
            // 범위 조건은 '2026-13-01' 같은 없는 날짜를 넣으면 MySQL이 에러를 낸다.
            // 예전 YEAR()·MONTH() 조건처럼 그런 달은 빈 목록으로 돌려준다.
            if (year < 1000 || year > 9999 || month < 1 || month > 12) return res.json([]);
            sql =
                'SELECT * FROM orders WHERE is_paid=1 AND created_at >= ? AND created_at < ? + INTERVAL 1 MONTH ORDER BY created_at DESC';
            const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
            params = [monthStart, monthStart];
        } else {
            sql =
                'SELECT * FROM orders WHERE is_paid=1 AND created_at >= CURDATE() - INTERVAL (DAY(CURDATE()) - 1) DAY AND created_at < LAST_DAY(CURDATE()) + INTERVAL 1 DAY ORDER BY created_at DESC';
            params = [];
        }
        const [rows] = await pool.query(sql, params);
        res.json(rows);
    } catch (/** @type {any} */ err) {
        console.error('[🔥 GET /api/admin/sales 에러]', err);
        res.status(500).json({
            success: false,
            message: '매출 내역을 불러오지 못했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const io = req.app.get('io');

    try {
        const [orderRows] = await pool.query('SELECT applied_event_id, quantity FROM orders WHERE id = ?', [id]);
        await pool.query('DELETE FROM orders WHERE id = ?', [id]);

        if (orderRows.length > 0) {
            const order = orderRows[0];

            if (order.applied_event_id) {
                await pool.query(
                    `
                    UPDATE events
                    SET used_count = GREATEST(0, used_count - ?)
                    WHERE id = ?
                      AND last_used_date = CURDATE()
                `,
                    [order.quantity, order.applied_event_id],
                );
                io.emit('events_updated');
            }
        }
        // 매출 행을 지웠으니 통계·정산 화면도 다시 받아와야 한다.
        req.app.get('io').emit('sales_updated');

        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        console.error(`[🔥 DELETE /api/admin/sales/${id} 에러]`, err);
        res.status(500).json({
            success: false,
            message: '매출 내역 삭제에 실패했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

module.exports = router;
