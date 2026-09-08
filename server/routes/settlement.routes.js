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
    } catch (/** @type {any} */ err) {
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
        req.app.get('io').emit('settlement_updated');
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
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
    } catch (/** @type {any} */ err) {
        console.error('[🔥 GET /api/settlement/calc 에러]', err);
        res.status(500).json({
            success: false,
            message: '마감 정산 금액을 계산하지 못했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

router.post('/close', authenticateToken, async (req, res) => {
    // 현금 매출과 차액은 클라이언트가 보낸 값을 쓰지 않고 여기서 다시 계산한다.
    // 캐셔가 시재 점검 창을 열어 현금을 세는 동안(몇 분 걸린다) 현금 주문이 더 들어오면,
    // 창을 열 때 받아 둔 매출은 이미 옛날 값이다. 그대로 저장하면 있지도 않은 차액이
    // 기록되거나 진짜 차액이 가려진다. 장부는 서버가 세는 게 맞다.
    const closingAmount = Number(req.body.closingAmount);
    if (!Number.isFinite(closingAmount) || closingAmount < 0) {
        return res.status(400).json({ success: false, message: '마감 시재 금액이 올바르지 않습니다.' });
    }
    try {
        const [rows] = await pool.query(
            'SELECT opening_amount, is_closed FROM cash_settlements WHERE date = CURDATE() LIMIT 1',
        );
        if (rows.length === 0) {
            return res.status(400).json({ success: false, message: '오늘 오픈 기록이 없습니다. 먼저 오픈해주세요.' });
        }
        if (rows[0]['is_closed']) {
            return res.status(409).json({ success: false, message: '오늘은 이미 마감되었습니다.' });
        }

        // /calc와 같은 기준으로 센다. 두 곳이 다르면 화면과 장부가 어긋난다.
        const [orders] = await pool.query(`SELECT IFNULL(SUM(total_price), 0) as cash_sales
                                           FROM orders
                                           WHERE is_paid = 1
                                             AND payment_method = 'cash'
                                             AND DATE(created_at) = CURDATE()`);
        const salesCash = parseInt(orders[0]['cash_sales']);
        const diff = closingAmount - (rows[0]['opening_amount'] + salesCash);

        // is_closed = 0 조건은 그대로 둔다. 두 사람이 동시에 마감을 눌러도 한 번만 통과한다.
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
            return res.status(409).json({ success: false, message: '오늘은 이미 마감되었습니다.' });
        }
        req.app.get('io').emit('settlement_updated');
        // 화면이 보여 준 값과 실제로 기록된 값이 다를 수 있으므로 결과를 돌려준다.
        res.json({ success: true, salesCash, diff });
    } catch (/** @type {any} */ err) {
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
    } catch (/** @type {any} */ err) {
        console.error('[🔥 GET /api/admin/settlements 에러]', err);
        res.status(500).json({
            success: false,
            message: '정산 내역을 불러오지 못했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

module.exports = router;
