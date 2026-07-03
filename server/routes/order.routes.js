const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken } = require('../middlewares/auth');
const debugInfo = require('../utils/debugInfo');

router.post('', authenticateToken, async (req, res) => {
    const { items, force, paymentMethod, staff_name, applied_event_id } = req.body;
    const io = req.app.get('io');
    let conn;
    let isEventUpdated = false;

    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();

        // 중복 주문 방지: 최근 1분 내에 '동일한 주문 묶음'(같은 메뉴 구성·총수량)이
        // 이미 들어왔는지 검사한다. (실수로 '주문 전송'을 두 번 누른 경우 감지)
        if (!force && items.length > 0) {
            // 메뉴별 총수량으로 정규화한 시그니처. 이벤트로 행이 쪼개져도 합쳐서 비교.
            const signatureOf = (list) => {
                const agg = {};
                for (const i of list) agg[i.menu_name] = (agg[i.menu_name] || 0) + Number(i.quantity);
                return Object.keys(agg)
                    .sort()
                    .map((k) => `${k}×${agg[k]}`)
                    .join('|');
            };
            const currentSig = signatureOf(items);

            const [recentRows] = await conn.query(`
                SELECT display_id, menu_name, quantity
                FROM orders
                WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 MINUTE)
            `);

            // 최근 주문들을 display_id별로 묶어 같은 시그니처가 있으면 중복으로 판단
            const groups = {};
            for (const r of recentRows) {
                (groups[r.display_id] = groups[r.display_id] || []).push(r);
            }
            const isDuplicate = Object.values(groups).some((g) => signatureOf(g) === currentSig);

            if (isDuplicate) {
                await conn.rollback();
                return res.json({ success: false, isDuplicate: true });
            }
        }

        // 메뉴 가격표를 DB에서 직접 로드 (클라이언트가 보낸 price는 신뢰하지 않음)
        const [menuRows] = await conn.query('SELECT name, price FROM menu');
        const menuMap = new Map(menuRows.map((m) => [m.name, Number(m.price)]));

        const SHOT_EXTRA = 500;

        // 메뉴명으로 서버 기준 단가를 계산. 샷은 "(샷 N개)" 접미사로 N잔당 +500*N.
        // 레거시 "(샷추가)"(=1샷)도 호환. 모르는 메뉴면 null.
        const resolveBaseUnitPrice = (menuName) => {
            let baseName = menuName;
            let shots = 0;
            const m = menuName.match(/^(.*) \(샷추가 (\d+)개\)$/);
            if (m) {
                baseName = m[1];
                shots = parseInt(m[2], 10);
            } else if (menuName.endsWith(' (샷추가)')) {
                baseName = menuName.slice(0, -' (샷추가)'.length);
                shots = 1;
            }
            if (!menuMap.has(baseName)) return null;
            return menuMap.get(baseName) + SHOT_EXTRA * shots;
        };

        // 이벤트가 지정된 경우, 가격 재계산에 필요한 필드까지 모두 잠금(FOR UPDATE) 조회
        let event = null;
        if (applied_event_id) {
            const [eventRows] = await conn.query(
                `
                SELECT id, type, discount_amount, daily_limit, target_menus, is_active,
                       IF(last_used_date = CURDATE(), used_count, 0) AS current_used_count
                FROM events
                WHERE id = ? FOR UPDATE
            `,
                [applied_event_id],
            );

            if (eventRows.length === 0 || eventRows[0].is_active !== 1) {
                await conn.rollback();
                return res.json({ success: false, message: '유효하지 않거나 종료된 이벤트입니다.' });
            }
            event = eventRows[0];
        }

        // 해당 메뉴가 이벤트 적용 대상인지 검사 (target_menus 기준)
        const isEligibleForEvent = (menuName) => {
            if (!event) return false;
            if (!event.target_menus || event.target_menus === 'all') return true;
            try {
                return JSON.parse(event.target_menus).some((t) => menuName.includes(t));
            } catch (e) {
                return false;
            }
        };

        // 각 아이템의 단가와 합계를 서버에서 재계산
        const computedItems = [];
        let eventQty = 0;
        for (const item of items) {
            const qty = parseInt(item.quantity, 10);
            if (!Number.isInteger(qty) || qty <= 0) {
                await conn.rollback();
                return res.json({ success: false, message: '주문 수량이 올바르지 않습니다.' });
            }

            const baseUnit = resolveBaseUnitPrice(item.menu_name);
            if (baseUnit === null) {
                await conn.rollback();
                return res.json({ success: false, message: `알 수 없는 메뉴입니다: ${item.menu_name}` });
            }

            // 이벤트 할인으로 태깅됐고 실제로 적용 가능한 경우에만 할인가 적용
            let unitPrice = baseUnit;
            let itemEventId = null;
            if (
                item.applied_event_id &&
                event &&
                Number(item.applied_event_id) === Number(applied_event_id) &&
                isEligibleForEvent(item.menu_name)
            ) {
                if (event.type === 'free') unitPrice = 0;
                else if (event.type === 'discount') unitPrice = Math.max(0, baseUnit - Number(event.discount_amount));
                itemEventId = event.id;
                eventQty += qty;
            }

            computedItems.push({
                menu_name: item.menu_name,
                quantity: qty,
                total_price: unitPrice * qty,
                applied_event_id: itemEventId,
            });
        }

        // 이벤트 한도 검사 (서버가 계산한 eventQty 기준)
        if (
            event &&
            eventQty > 0 &&
            event.daily_limit !== null &&
            event.current_used_count + eventQty > event.daily_limit
        ) {
            await conn.rollback();
            return res.json({
                success: false,
                message: `해당 이벤트 한도를 초과했습니다. (오늘 남은 수량: ${event.daily_limit - event.current_used_count}잔)`,
            });
        }

        // 이벤트 사용량 차감 (오늘이면 누적, 날짜가 바뀌었으면 새로 시작)
        if (event && eventQty > 0) {
            await conn.query(
                `
                UPDATE events
                SET used_count     = IF(last_used_date = CURDATE(), used_count + ?, ?),
                    last_used_date = CURDATE()
                WHERE id = ?
            `,
                [eventQty, eventQty, event.id],
            );
            isEventUpdated = true;
        }

        // 주문 번호 생성: 날짜별 카운터 행을 원자적으로 증가시킨다.
        // INSERT...ON DUPLICATE KEY UPDATE가 PK(order_date) 행에 잠금을 잡으므로
        // 동시에 들어온 주문들도 직렬화되어 번호가 중복되지 않는다.
        // (LAST_INSERT_ID는 커넥션 단위라 같은 conn 안에서 안전하게 값을 회수한다)
        await conn.query(`
            INSERT INTO daily_order_counters (order_date, last_number)
            VALUES (CURDATE(), LAST_INSERT_ID(1))
            ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)
        `);
        // 주문번호 날짜 접두사도 카운터와 같은 DB 시간대(CURDATE = KST)로 산출 → JS의 UTC 날짜와 어긋남 방지
        const [seqRows] = await conn.query("SELECT LAST_INSERT_ID() AS seq, DATE_FORMAT(CURDATE(), '%Y%m%d') AS ymd");
        const nextDailyNum = seqRows[0]['seq'];
        const formattedID = `${seqRows[0]['ymd']}-${String(nextDailyNum).padStart(3, '0')}`;

        for (const item of computedItems) {
            await conn.query(
                `INSERT INTO orders (menu_name, quantity, total_price, daily_number, display_id, payment_method,
                                     staff_name, applied_event_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    item.menu_name,
                    item.quantity,
                    item.total_price,
                    nextDailyNum,
                    formattedID,
                    paymentMethod || 'cash',
                    staff_name || '키오스크',
                    item.applied_event_id,
                ],
            );
        }

        await conn.commit();

        if (isEventUpdated) {
            io.emit('events_updated');
        }

        io.emit('new_order', {
            display_id: formattedID,
            daily_number: String(nextDailyNum).padStart(3, '0'),
            items: computedItems.map((i) => ({ menu_name: i.menu_name, quantity: i.quantity, price: i.total_price })),
            created_at: new Date(),
            payment_method: paymentMethod || 'cash',
            staff_name: staff_name || '키오스크',
            is_paid: 0,
            is_completed: 0,
        });

        res.json({ success: true });
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
            debug_info: debugInfo(error),
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
            debug_info: debugInfo(error),
        });
    }
});

router.patch('/:display_id/deliver', authenticateToken, async (req, res) => {
    const { display_id } = req.params;
    const io = req.app.get('io');

    try {
        await pool.query('UPDATE orders SET is_delivered = 1 WHERE display_id = ?', [display_id]);
        const [rows] = await pool.query('SELECT is_paid, is_completed FROM orders WHERE display_id = ? LIMIT 1', [
            display_id,
        ]);

        io.emit('order_updated', { display_id, ...rows[0], is_delivered: 1 });
        res.json({ success: true });
    } catch (err) {
        console.error(`[🔥 PATCH /api/orders/${display_id}/deliver 에러]`, err);
        res.status(500).json({
            success: false,
            message: '주문 전달 처리에 실패했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

router.patch('/:display_id/complete', authenticateToken, async (req, res) => {
    const { display_id } = req.params;
    const io = req.app.get('io');

    try {
        await pool.query('UPDATE orders SET is_paid = 1, is_completed = 1, payment_method = ? WHERE display_id = ?', [
            req.body.paymentMethod || 'cash',
            display_id,
        ]);
        io.emit('order_updated', { display_id, is_paid: 1, is_completed: 1 });
        res.json({ success: true });
    } catch (err) {
        console.error(`[🔥 PATCH /api/orders/${display_id}/complete 에러]`, err);
        res.status(500).json({
            success: false,
            message: '주문 완료 처리에 실패했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

router.patch('/:display_id/pay', authenticateToken, async (req, res) => {
    const { display_id } = req.params;
    const io = req.app.get('io');

    try {
        await pool.query('UPDATE orders SET is_paid = 1, payment_method = ? WHERE display_id = ?', [
            req.body.paymentMethod || 'cash',
            display_id,
        ]);
        const [rows] = await pool.query('SELECT is_completed FROM orders WHERE display_id = ? LIMIT 1', [display_id]);

        io.emit('order_updated', { display_id, is_paid: 1, is_completed: rows[0]?.is_completed || 0 });
        res.json({ success: true });
    } catch (err) {
        console.error(`[🔥 PATCH /api/orders/${display_id}/pay 에러]`, err);
        res.status(500).json({
            success: false,
            message: '결제 처리에 실패했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

router.patch('/:display_id/complete_kitchen', authenticateToken, async (req, res) => {
    const { display_id } = req.params;
    const io = req.app.get('io');

    try {
        await pool.query('UPDATE orders SET is_completed = 1 WHERE display_id = ?', [display_id]);
        io.emit('order_updated', { display_id, is_completed: 1 });
        res.json({ success: true });
    } catch (err) {
        console.error(`[🔥 PATCH /api/orders/${display_id}/complete_kitchen 에러]`, err);
        res.status(500).json({
            success: false,
            message: '주방 조리 완료 처리에 실패했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

router.delete('/:display_id', authenticateToken, async (req, res) => {
    const { display_id } = req.params;
    const io = req.app.get('io');

    try {
        const [usedEvents] = await pool.query(
            `
            SELECT applied_event_id, SUM(quantity) as qty
            FROM orders
            WHERE display_id = ?
              AND applied_event_id IS NOT NULL
            GROUP BY applied_event_id
        `,
            [display_id],
        );

        await pool.query('DELETE FROM orders WHERE display_id = ?', [display_id]);

        if (usedEvents.length > 0) {
            for (const row of usedEvents) {
                await pool.query(
                    `
                    UPDATE events
                    SET used_count =GREATEST(0, used_count - ?)
                    WHERE id = ?
                      AND last_used_date = CURDATE()
                `,
                    [row.qty, row.applied_event_id],
                );
            }
            io.emit('events_updated');
        }
        io.emit('order_deleted', display_id);
        res.json({ success: true });
    } catch (err) {
        console.error(`[🔥 DELETE /api/orders/${display_id} 에러]`, err);
        res.status(500).json({
            success: false,
            message: '주문 취소에 실패했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

module.exports = router;
