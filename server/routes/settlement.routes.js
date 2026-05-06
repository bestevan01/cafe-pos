const express = require('express')
const router = express.Router();
const pool = require("../config/db");
const {authenticateToken, requireAdmin} = require("../middlewares/auth");

router.get('/status', authenticateToken, async (req, res) => {
    try {
        const [todayRows] = await pool.query('SELECT * FROM cash_settlements WHERE date = CURDATE()');
        if (todayRows.length === 0) {
            const [prevRows] = await pool.query('SELECT closing_amount FROM cash_settlements WHERE is_closed = 1 ORDER BY date DESC, created_at DESC LIMIT 1');
            const prevClosing = prevRows.length > 0 ? Number(prevRows[0]['closing_amount']) : 0;
            res.json({status: 'not_opened', prevClosing});
        } else {
            res.json({status: todayRows[0]['is_closed'] ? 'closed' : 'opened', data: todayRows[0]});
        }
    } catch (err) {
        console.error('[🔥 GET /api/settlement/status 에러]', err);
        res.status(500).json({
            success: false,
            message: '시재 점검 상태를 확인하지 못했습니다.',
            debug_info: err.message
        });
    }
});

router.post('/open', authenticateToken, async (req, res) => {
    try {
        await pool.query('INSERT INTO cash_settlements (date, opening_amount) VALUES (CURDATE(), ?)', [req.body.amount]);
        res.json({success: true});
    } catch (err) {
        console.error('[🔥 POST /api/settlement/open 에러]', err);
        res.status(500).json({
            success: false,
            message: '영업 시작(오픈) 처리에 실패했습니다.',
            debug_info: err.message
        });
    }
});

router.get('/calc', authenticateToken, async (req, res) => {
    try {
        const [settlement] = await pool.query('SELECT opening_amount FROM cash_settlements WHERE date = CURDATE()');
        if (settlement.length === 0) return res.status(400).json({message: "미오픈 상태"});

        const [orders] = await pool.query(`SELECT IFNULL(SUM(total_price), 0) as cash_sales
                                           FROM orders
                                           WHERE is_paid = 1
                                             AND payment_method = 'cash'
                                             AND DATE(created_at) = CURDATE()`);
        const opening = settlement[0]['opening_amount'];
        const cashSales = parseInt(orders[0]['cash_sales']);

        res.json({opening, sales: cashSales, expected: opening + cashSales});
    } catch (err) {
        console.error('[🔥 GET /api/settlement/calc 에러]', err);
        res.status(500).json({
            success: false,
            message: '마감 정산 금액을 계산하지 못했습니다.',
            debug_info: err.message
        });
    }
});

router.post('/close', authenticateToken, async (req, res) => {
    const {closingAmount, salesCash, diff} = req.body;
    try {
        await pool.query(
            `UPDATE cash_settlements
             SET closing_amount = ?,
                 sales_cash     = ?,
                 difference     = ?,
                 is_closed      = 1
             WHERE date = CURDATE()`,
            [closingAmount, salesCash, diff]
        );
        res.json({success: true});
    } catch (err) {
        console.error('[🔥 POST /api/settlement/close 에러]', err);
        res.status(500).json({
            success: false,
            message: '영업 종료(마감) 처리에 실패했습니다.',
            debug_info: err.message
        });
    }
});

router.get('/history', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM cash_settlements ORDER BY date DESC');
        res.json(rows);
    } catch (err) {
        console.error('[🔥 GET /api/admin/settlements 에러]', err);
        res.status(500).json({
            success: false,
            message: '정산 내역을 불러오지 못했습니다.',
            debug_info: err.message
        });
    }
});

module.exports = router;