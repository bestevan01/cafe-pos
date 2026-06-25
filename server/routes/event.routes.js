const express = require('express')
const router = express.Router();
const pool = require('../config/db')
const {authenticateToken, requireAdmin} = require('../middlewares/auth')
const debugInfo = require('../utils/debugInfo')

router.get('/', authenticateToken, async (req, res) => {
    try {
        const query = `
            SELECT id,
                   name,
                   type,
                   discount_amount,
                   daily_limit,
                   target_menus,
                   is_active,
                   IF(last_used_date = CURDATE(), used_count, 0) AS used_count
            FROM events
            ORDER BY id DESC
        `;
        const [rows] = await pool.query(query);
        res.json(rows);
    } catch (err) {
        console.error(`[🔥 GET /api/events 에러]`, err);
        res.status(500).json({
            success: false,
            message: '이벤트 조회에 실패했습니다.',
            debug_info: debugInfo(err)
        });
    }
});

router.post('/', authenticateToken, requireAdmin, async (req, res) => {
    const {name, type, discount_amount, daily_limit, target_menus, is_active} = req.body;
    if (!name || !['free', 'discount'].includes(type)) {
        return res.status(400).json({success: false, message: '이벤트 이름과 유형(무료/할인)을 올바르게 입력해주세요.'});
    }
    try {
        const [result] = await pool.query(
            'INSERT INTO events (name, type, discount_amount, daily_limit, target_menus, is_active) VALUES (?, ?, ?, ?, ?, ?)',
            [
                name,
                type,
                discount_amount || 0,
                daily_limit || null,
                target_menus || 'all',
                is_active ? 1 : 0
            ]
        );
        res.json({success: true, id: result.insertId});
    } catch (err) {
        console.error(`[🔥 POST /api/events 에러]`, err);
        res.status(500).json({
            success: false,
            message: '이벤트 등록에 실패했습니다.',
            debug_info: debugInfo(err)
        });
    }
});

router.patch('/:id/toggle', authenticateToken, requireAdmin, async (req, res) => {
    const {id} = req.params;
    const {is_active} = req.body;
    try {
        await pool.query('UPDATE events SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, id]);
        req.app.get('io').emit('events_updated');
        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 PATCH /api/events/${id} 에러]`, err);
        res.status(500).json({
            success: false,
            message: '이벤트 상태 변경에 실패했습니다.',
            debug_info: debugInfo(err)
        });
    }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    const {id} = req.params;
    try {
        await pool.query('DELETE FROM events WHERE id = ?', [id]);
        req.app.get('io').emit('events_updated');
        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 DELETE /api/events/${id} 에러]`, err);
        res.status(500).json({
            success: false,
            message: '이벤트 삭제에 실패했습니다.',
            debug_info: debugInfo(err)
        });
    }
});

module.exports = router;