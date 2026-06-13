const express = require('express')
const router = express.Router();
const pool = require("../config/db");
const {authenticateToken, requireAdmin} = require("../middlewares/auth");
const debugInfo = require("../utils/debugInfo");

router.get('', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM menu');
        res.json(rows);
    } catch (err) {
        console.error('[🔥 GET /api/menu 에러]', err);
        res.status(500).json({
            success: false,
            message: '메뉴 목록을 불러오는 중 오류가 발생했습니다.',
            debug_info: debugInfo(err)
        });
    }
});

router.post('', authenticateToken, requireAdmin, async (req, res) => {
    const {name, price, type} = req.body;
    try {
        await pool.query('INSERT INTO menu (name, price, type) VALUES (?, ?, ?)', [name, price, type]);
        res.json({success: true});
    } catch (err) {
        console.error('[🔥 POST /api/menu 에러]', err);
        res.status(500).json({
            success: false,
            message: '메뉴 추가 중 오류가 발생했습니다.',
            debug_info: debugInfo(err)
        });
    }
});

router.patch('/:id', authenticateToken, requireAdmin, async (req, res) => {
    const {id} = req.params;
    const {name, price, type, is_soldout} = req.body;
    let fields = [], values = [];

    if (name) {
        fields.push('name = ?');
        values.push(name);
    }
    if (price !== undefined) {
        fields.push('price = ?');
        values.push(price);
    }
    if (type) {
        fields.push('type = ?');
        values.push(type);
    }
    if (is_soldout !== undefined) {
        fields.push('is_soldout = ?');
        values.push(is_soldout);
    }
    values.push(id);

    try {
        if (fields.length > 0) {
            await pool.query(`UPDATE menu
                              SET ${fields.join(', ')}
                              WHERE id = ?`, values);
        }
        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 PATCH /api/menu/${id} 에러]`, err);
        res.status(500).json({
            success: false,
            message: '메뉴 수정 중 오류가 발생했습니다.',
            debug_info: debugInfo(err)
        });
    }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    const {id} = req.params;
    try {
        await pool.query('DELETE FROM menu WHERE id = ?', [id]);
        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 DELETE /api/menu/${id} 에러]`, err);
        res.status(500).json({
            success: false,
            message: '메뉴 삭제 중 오류가 발생했습니다.',
            debug_info: debugInfo(err)
        });
    }
});

module.exports = router;