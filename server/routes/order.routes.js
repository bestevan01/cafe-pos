const express = require('express')
const router = express.Router();
const pool = require("../config/db");
const {authenticateToken} = require("../middlewares/auth");

router.post('', authenticateToken, async (req, res) => {
    const {items, force, paymentMethod, staff_name, applied_event_id, applied_event_qty} = req.body;
    const io = req.app.get('io');
    let conn;
    let isEventUpdated = false;

    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();

        // 중복 주문 방지 (1분 내 동일 메뉴/수량)
        if (!force && items.length > 0) {
            const [rows] = await conn.query(`
                SELECT *
                FROM orders
                WHERE menu_name = ?
                  AND quantity = ?
                  AND created_at > DATE_SUB(NOW(), INTERVAL 1 MINUTE)
            `, [items[0].menu_name, items[0].quantity]);

            if (rows.length > 0) {
                await conn.rollback();
                return res.json({success: false, isDuplicate: true});
            }
        }

        if (applied_event_id && applied_event_qty > 0) {
            // FOR UPDATE를 붙여서 다른 캐셔가 동시에 결제하지 못하게 잠깐 줄을 세웁니다.
            const [eventRows] = await conn.query(`
                SELECT daily_limit, IF(last_used_date = CURDATE(), used_count, 0) AS current_used_count
                FROM events
                WHERE id = ? FOR
                UPDATE
            `, [applied_event_id]);

            if (eventRows.length > 0) {
                const ev = eventRows[0];

                // 한도 초과 검사
                if (ev.daily_limit !== null && (ev['current_used_count'] + applied_event_qty > ev.daily_limit)) {
                    await conn.rollback(); // 수량이 초과되면 주문 전체를 취소(롤백)합니다.
                    return res.json({
                        success: false,
                        message: `해당 이벤트 한도를 초과했습니다. (오늘 남은 수량: ${ev.daily_limit - ev['current_used_count']}잔)`
                    });
                }

                // 통과했다면 차감 업데이트! (어제면 덮어씌우고, 오늘이면 기존 값에 더합니다. 날짜는 오늘로 갱신)
                await conn.query(`
                    UPDATE events
                    SET used_count     = IF(last_used_date = CURDATE(), used_count + ?, ?),
                        last_used_date = CURDATE()
                    WHERE id = ?
                `, [applied_event_qty, applied_event_qty, applied_event_id]);

                isEventUpdated = true;
            }
        }

        // 주문 번호 생성
        const [rows] = await conn.query(`SELECT MAX(daily_number) as maxNum
                                         FROM orders
                                         WHERE DATE(created_at) = CURDATE()`);
        const nextDailyNum = (rows[0]['maxNum'] || 0) + 1;
        const formattedID = `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(nextDailyNum).padStart(3, "0")}`;

        for (const item of items) {
            await conn.query(
                `INSERT INTO orders (menu_name, quantity, total_price, daily_number, display_id, payment_method,
                                     staff_name, applied_event_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [item.menu_name, item.quantity, item.price * item.quantity, nextDailyNum, formattedID, paymentMethod || 'cash', staff_name || '키오스크', item.applied_event_id || null]
            );
        }

        await conn.commit();

        if (isEventUpdated) {
            io.emit('events_updated');
        }

        io.emit('new_order', {
            display_id: formattedID,
            daily_number: String(nextDailyNum).padStart(3, "0"),
            items: items.map(i => ({menu_name: i.menu_name, quantity: i.quantity, price: i.price * i.quantity})),
            created_at: new Date(),
            payment_method: paymentMethod || 'cash',
            staff_name: staff_name || '키오스크',
            is_paid: 0,
            is_completed: 0
        });

        res.json({success: true});
    } catch (error) {
        console.error(`[🔥 POST /api/orders 원본 에러] 주문자: ${staff_name || '키오스크'}`, error);

        if (conn) {
            try {
                await conn.rollback();
            } catch (rollbackError) {
                console.error(`[⚠️ DB 롤백 실패 (연결 끊김)]`, rollbackError.message);
            }
        }
        res.status(500).json({
            success: false,
            message: '주문 처리에 실패했습니다.',
            debug_info: error.message
        });
    } finally {
        if (conn) conn.release();
    }
});

router.get('', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM orders WHERE is_delivered = 0 ORDER BY created_at DESC');
        res.json(rows);
    } catch (error) {
        console.error('[🔥 GET /api/orders 에러]', error);
        res.status(500).json({
            success: false,
            message: '주문 목록을 불러오지 못했습니다.',
            debug_info: error.message
        });
    }
});

router.patch('/:display_id/deliver', authenticateToken, async (req, res) => {
    const {display_id} = req.params;
    const io = req.app.get('io');

    try {
        await pool.query('UPDATE orders SET is_delivered = 1 WHERE display_id = ?', [display_id]);
        const [rows] = await pool.query('SELECT is_paid, is_completed FROM orders WHERE display_id = ? LIMIT 1', [display_id]);

        io.emit('order_updated', {display_id, ...rows[0], is_delivered: 1});
        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 PATCH /api/orders/${display_id}/deliver 에러]`, err);
        res.status(500).json({
            success: false,
            message: '주문 전달 처리에 실패했습니다.',
            debug_info: err.message
        });
    }
});

router.patch('/:display_id/complete', authenticateToken, async (req, res) => {
    const {display_id} = req.params;
    const io = req.app.get('io');

    try {
        await pool.query('UPDATE orders SET is_paid = 1, is_completed = 1, payment_method = ? WHERE display_id = ?', [req.body.paymentMethod || 'cash', display_id]);
        io.emit('order_updated', {display_id, is_paid: 1, is_completed: 1});
        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 PATCH /api/orders/${display_id}/complete 에러]`, err);
        res.status(500).json({
            success: false,
            message: '주문 완료 처리에 실패했습니다.',
            debug_info: err.message
        });
    }
});

router.patch('/:display_id/pay', authenticateToken, async (req, res) => {
    const {display_id} = req.params;
    const io = req.app.get('io');

    try {
        await pool.query('UPDATE orders SET is_paid = 1, payment_method = ? WHERE display_id = ?', [req.body.paymentMethod || 'cash', display_id]);
        const [rows] = await pool.query('SELECT is_completed FROM orders WHERE display_id = ? LIMIT 1', [display_id]);

        io.emit('order_updated', {display_id, is_paid: 1, is_completed: rows[0]?.is_completed || 0});
        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 PATCH /api/orders/${display_id}/pay 에러]`, err);
        res.status(500).json({
            success: false,
            message: '결제 처리에 실패했습니다.',
            debug_info: err.message
        });
    }
});

router.patch('/:display_id/complete_kitchen', authenticateToken, async (req, res) => {
    const {display_id} = req.params;
    const io = req.app.get('io');

    try {
        await pool.query('UPDATE orders SET is_completed = 1 WHERE display_id = ?', [display_id]);
        io.emit('order_updated', {display_id, is_completed: 1});
        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 PATCH /api/orders/${display_id}/complete_kitchen 에러]`, err);
        res.status(500).json({
            success: false,
            message: '주방 조리 완료 처리에 실패했습니다.',
            debug_info: err.message
        });
    }
});

router.delete('/:display_id', authenticateToken, async (req, res) => {
    const {display_id} = req.params;
    const io = req.app.get('io');

    try {
        const [usedEvents] = await pool.query(`
            SELECT applied_event_id, SUM(quantity) as qty
            FROM orders
            WHERE display_id = ?
              AND applied_event_id IS NOT NULL
            GROUP BY applied_event_id
        `, [display_id]);

        await pool.query('DELETE FROM orders WHERE display_id = ?', [display_id]);

        if (usedEvents.length > 0) {
            for (const row of usedEvents) {
                await pool.query(`
                    UPDATE events
                    SET used_count =GREATEST(0, used_count - ?)
                    WHERE id = ?
                      AND last_used_date = CURDATE()
                `, [row.qty, row.applied_event_id]);
            }
            io.emit('events_updated');
        }
        io.emit('order_deleted', display_id);
        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 DELETE /api/orders/${display_id} 에러]`, err);
        res.status(500).json({
            success: false,
            message: '주문 취소에 실패했습니다.',
            debug_info: err.message
        });
    }
});

module.exports = router;