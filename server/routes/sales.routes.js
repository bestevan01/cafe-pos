const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken, requireAdmin } = require('../middlewares/auth');
const debugInfo = require('../utils/debugInfo');

// 요약 통계: 행을 받지 않고 서버에서 SUM 집계 → 데이터가 아무리 쌓여도 즉시.
router.get('/summary', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [[today]] = await pool.query(
            'SELECT IFNULL(SUM(total_price),0) AS s FROM orders WHERE is_paid=1 AND DATE(created_at)=CURDATE()',
        );
        const [[month]] = await pool.query(
            'SELECT IFNULL(SUM(total_price),0) AS s FROM orders WHERE is_paid=1 AND YEAR(created_at)=YEAR(CURDATE()) AND MONTH(created_at)=MONTH(CURDATE())',
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
            periods: periods.map((p) => ({ year: Number(p.year), month: Number(p.month) })),
        });
    } catch (err) {
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
        const year = parseInt(req.query.year, 10);
        const month = parseInt(req.query.month, 10);
        let sql, params;
        if (year && month) {
            sql =
                'SELECT * FROM orders WHERE is_paid=1 AND YEAR(created_at)=? AND MONTH(created_at)=? ORDER BY created_at DESC';
            params = [year, month];
        } else {
            sql =
                'SELECT * FROM orders WHERE is_paid=1 AND YEAR(created_at)=YEAR(CURDATE()) AND MONTH(created_at)=MONTH(CURDATE()) ORDER BY created_at DESC';
            params = [];
        }
        const [rows] = await pool.query(sql, params);
        res.json(rows);
    } catch (err) {
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

        res.json({ success: true });
    } catch (err) {
        console.error(`[🔥 DELETE /api/admin/sales/${id} 에러]`, err);
        res.status(500).json({
            success: false,
            message: '매출 내역 삭제에 실패했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

module.exports = router;
