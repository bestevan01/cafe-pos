const express = require('express');
const router = express.Router();
const pool = require('../config/db')
const {authenticateToken, requireAdmin} = require('../middlewares/auth')
const debugInfo = require('../utils/debugInfo')

router.get('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [itemRows] = await pool.query(`SELECT menu_name,
                                                    SUM(quantity)    as total_qty,
                                                    SUM(total_price) as total_sales
                                             FROM orders
                                             WHERE is_paid = 1
                                             GROUP BY menu_name
                                             ORDER BY total_sales DESC`);
        const [timeRows] = await pool.query(`SELECT HOUR(created_at) as hour,
                                                    COUNT(*)         as order_count,
                                                    SUM(total_price) as total_sales
                                             FROM orders
                                             WHERE is_paid = 1
                                             GROUP BY HOUR(created_at)
                                             ORDER BY hour`);
        res.json({itemStats: itemRows, timeStats: timeRows});
    } catch (err) {
        console.error('[🔥 GET /api/admin/stats 에러]', err);
        res.status(500).json({
            success: false,
            message: '통계 데이터를 집계하는 중 오류가 발생했습니다.',
            debug_info: debugInfo(err)
        });
    }
});

module.exports = router;