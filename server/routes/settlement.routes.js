const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken, requireAdmin } = require('../middlewares/auth');
const debugInfo = require('../utils/debugInfo');

router.get('/status', authenticateToken, async (req, res) => {
    try {
        const [todayRows] = await pool.query('SELECT * FROM cash_settlements WHERE date = CURDATE()');
        if (todayRows.length === 0) {
            const [prevRows] = await pool.query(
                'SELECT closing_amount FROM cash_settlements WHERE is_closed = 1 ORDER BY date DESC, created_at DESC LIMIT 1',
            );
            const prevClosing = prevRows.length > 0 ? Number(prevRows[0]['closing_amount']) : 0;
            res.json({ status: 'not_opened', prevClosing });
        } else {
            res.json({ status: todayRows[0]['is_closed'] ? 'closed' : 'opened', data: todayRows[0] });
        }
    } catch (err) {
        console.error('[🔥 GET /api/settlement/status 에러]', err);
        res.status(500).json({
            success: false,
            message: '시재 점검 상태를 확인하지 못했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

router.post('/open', authenticateToken, async (req, res) => {
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount < 0) {
        return res.status(400).json({ success: false, message: '시재 금액이 올바르지 않습니다.' });
    }
    try {
        // 1차 방어(앱 레벨): 오늘 이미 오픈했으면 거부 — 중복 레코드 생성 방지
        const [existing] = await pool.query('SELECT 1 FROM cash_settlements WHERE date = CURDATE() LIMIT 1');
        if (existing.length > 0) {
            return res.status(409).json({ success: false, message: '오늘은 이미 오픈되었습니다.' });
        }

        await pool.query('INSERT INTO cash_settlements (date, opening_amount) VALUES (CURDATE(), ?)', [amount]);
        res.json({ success: true });
    } catch (err) {
        // 2차 방어(DB 레벨): date에 UNIQUE 제약이 있으면 동시 오픈 경쟁도 여기서 차단됨
        if (err && err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: '오늘은 이미 오픈되었습니다.' });
        }
        console.error('[🔥 POST /api/settlement/open 에러]', err);
        res.status(500).json({
            success: false,
            message: '영업 시작(오픈) 처리에 실패했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

router.get('/calc', authenticateToken, async (req, res) => {
    try {
        const [settlement] = await pool.query('SELECT opening_amount FROM cash_settlements WHERE date = CURDATE()');
        if (settlement.length === 0) return res.status(400).json({ message: '미오픈 상태' });

        const [orders] = await pool.query(`SELECT IFNULL(SUM(total_price), 0) as cash_sales
                                           FROM orders
                                           WHERE is_paid = 1
                                             AND payment_method = 'cash'
                                             AND DATE(created_at) = CURDATE()`);
        const opening = settlement[0]['opening_amount'];
        const cashSales = parseInt(orders[0]['cash_sales']);

        res.json({ opening, sales: cashSales, expected: opening + cashSales });
    } catch (err) {
        console.error('[🔥 GET /api/settlement/calc 에러]', err);
        res.status(500).json({
            success: false,
            message: '마감 정산 금액을 계산하지 못했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

router.post('/close', authenticateToken, async (req, res) => {
    const { closingAmount, salesCash, diff } = req.body;
    try {
        // 오픈된(아직 안 닫힌) 당일 행만 마감한다. 0행이면 미오픈/이미마감을 구분해 안내.
        const [result] = await pool.query(
            `UPDATE cash_settlements
             SET closing_amount = ?,
                 sales_cash     = ?,
                 difference     = ?,
                 is_closed      = 1
             WHERE date = CURDATE() AND is_closed = 0`,
            [closingAmount, salesCash, diff],
        );
        if (result.affectedRows === 0) {
            const [rows] = await pool.query('SELECT is_closed FROM cash_settlements WHERE date = CURDATE() LIMIT 1');
            if (rows.length === 0) {
                return res
                    .status(400)
                    .json({ success: false, message: '오늘 오픈 기록이 없습니다. 먼저 오픈해주세요.' });
            }
            return res.status(409).json({ success: false, message: '오늘은 이미 마감되었습니다.' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error('[🔥 POST /api/settlement/close 에러]', err);
        res.status(500).json({
            success: false,
            message: '영업 종료(마감) 처리에 실패했습니다.',
            debug_info: debugInfo(err),
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
            debug_info: debugInfo(err),
        });
    }
});

module.exports = router;
