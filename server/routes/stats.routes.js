const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken, requireAdmin } = require('../middlewares/auth');
const debugInfo = require('../utils/debugInfo');

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
        // 요일별 집계. DB 세션이 +09:00으로 고정돼 있어(config/db.js) 한국 시간 기준 요일이 나온다.
        // DAYOFWEEK는 1=일 ~ 7=토. 표시 순서(월~일) 정렬은 클라이언트가 맡는다.
        const [dowRows] = await pool.query(`SELECT DAYOFWEEK(created_at) as dow,
                                                   COUNT(*)              as order_count,
                                                   SUM(total_price)      as total_sales
                                            FROM orders
                                            WHERE is_paid = 1
                                            GROUP BY dow
                                            ORDER BY dow`);
        // 요약 지표. 한 주문이 메뉴 수만큼 여러 행으로 나뉘므로
        // '주문 건수'는 행 수가 아니라 display_id의 고유 개수여야 한다.
        // (COUNT(DISTINCT ...)는 NULL을 세지 않으므로 display_id가 비어 있던
        //  과거 행이 있다면 건수에서 빠진다.)
        const [summaryRows] = await pool.query(`SELECT COUNT(DISTINCT display_id) as order_count,
                                                       IFNULL(SUM(total_price), 0) as total_sales
                                                FROM orders
                                                WHERE is_paid = 1`);
        const orderCount = Number(summaryRows[0]['order_count']) || 0;
        const totalSales = Number(summaryRows[0]['total_sales']) || 0;

        res.json({
            itemStats: itemRows,
            timeStats: timeRows,
            dowStats: dowRows,
            summary: {
                totalSales,
                orderCount,
                // 객단가 = 총매출 / 주문 건수. 주문이 없으면 0.
                avgOrderValue: orderCount > 0 ? Math.round(totalSales / orderCount) : 0,
            },
        });
    } catch (/** @type {any} */ err) {
        console.error('[🔥 GET /api/admin/stats 에러]', err);
        res.status(500).json({
            success: false,
            message: '통계 데이터를 집계하는 중 오류가 발생했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

module.exports = router;
