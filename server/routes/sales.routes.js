const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const {authenticateToken, requireAdmin} = require("../middlewares/auth");
const debugInfo = require("../utils/debugInfo");

router.get('', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM orders WHERE is_paid = 1 ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) {
        console.error('[🔥 GET /api/admin/sales 에러]', err);
        res.status(500).json({
            success: false,
            message: '매출 내역을 불러오지 못했습니다.',
            debug_info: debugInfo(err)
        });
    }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    const {id} = req.params;
    const io = req.app.get('io');

    try {
        const [orderRows] = await pool.query('SELECT applied_event_id, quantity FROM orders WHERE id = ?', [id]);
        await pool.query('DELETE FROM orders WHERE id = ?', [id]);

        if (orderRows.length > 0) {
            const order = orderRows[0];

            if (order.applied_event_id) {
                await pool.query(`
                    UPDATE events
                    SET used_count = GREATEST(0, used_count - ?)
                    WHERE id = ?
                      AND last_used_date = CURDATE()
                `, [order.quantity, order.applied_event_id]);
                io.emit('events_updated');
            }
        }

        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 DELETE /api/admin/sales/${id} 에러]`, err);
        res.status(500).json({
            success: false,
            message: '매출 내역 삭제에 실패했습니다.',
            debug_info: debugInfo(err)
        });
    }
});

module.exports = router;