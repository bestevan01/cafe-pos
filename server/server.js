// ---------------------------------------------------------
// [1] 환경 설정 및 모듈 가져오기
// ---------------------------------------------------------
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config({path: '../.env'});
}

const express = require('express');
const morgan = require('morgan');
const http = require('http');
const {Server} = require('socket.io');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse
} = require('@simplewebauthn/server');

// 환경 변수 및 상수 설정
const PORT = process.env.PORT;
const FRONTEND_URL = 'bu-cafe-pos.vercel.app';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error("🚨 FATAL: JWT_SECRET is missing.");
    process.exit(1);
}

// WebAuthn 및 CORS 설정
const RP_ID = IS_PRODUCTION ? FRONTEND_URL : 'localhost';
const EXPECTED_ORIGIN = IS_PRODUCTION ? `https://${FRONTEND_URL}` : 'http://localhost:5173';
const CORS_ORIGIN = IS_PRODUCTION ? `https://${FRONTEND_URL}` : "http://localhost:5173";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {origin: CORS_ORIGIN, methods: ["GET", "POST"]}
});

// ---------------------------------------------------------
// [2] 미들웨어 설정
// ---------------------------------------------------------
app.use(cors({
    origin: CORS_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"]
}));
app.use(express.json());
app.use(morgan('dev'));

// 인증 미들웨어 (JWT 검증)
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({message: '로그인이 필요합니다.'});

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({message: '유효하지 않은 토큰입니다.'});
        req.user = user;
        next();
    });
};

// 관리자 권한 미들웨어
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({message: '관리자 권한이 필요합니다.'});
    }
    next();
};

// ---------------------------------------------------------
// [3] 데이터베이스 연결 (MySQL)
// ---------------------------------------------------------
/** @type {any} */
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: {minVersion: 'TLSv1.2', rejectUnauthorized: IS_PRODUCTION},
    timezone: '+09:00'
});

pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+09:00';");
});

pool.getConnection()
    .then(conn => {
        console.log("✅ [DB] 데이터베이스 연결 성공!");
        conn.release();
    })
    .catch(err => {
        console.error("❌ [DB] 데이터베이스 연결 실패:", err);
    });


// ---------------------------------------------------------
// [4] API 라우트: 메뉴 (Menu)
// ---------------------------------------------------------
app.get('/api/menu', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM menu');
        res.json(rows);
    } catch (err) {
        console.error('[🔥 GET /api/menu 에러]', err);
        res.status(500).json({
            success: false,
            message: '메뉴 목록을 불러오는 중 오류가 발생했습니다.',
            debug_info: err.message
        });
    }
});

app.post('/api/menu', authenticateToken, requireAdmin, async (req, res) => {
    const {name, price, type} = req.body;
    try {
        await pool.query('INSERT INTO menu (name, price, type) VALUES (?, ?, ?)', [name, price, type]);
        res.json({success: true});
    } catch (err) {
        console.error('[🔥 POST /api/menu 에러]', err);
        res.status(500).json({
            success: false,
            message: '메뉴 추가 중 오류가 발생했습니다.',
            debug_info: err.message
        });
    }
});

app.patch('/api/menu/:id', authenticateToken, requireAdmin, async (req, res) => {
    const {id} = req.params;
    const {name, price, type, is_soldout} = req.body;
    let fields = [], values = [];

    if (name) {
        fields.push('name = ?');
        values.push(name);
    }
    if (price) {
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
            debug_info: err.message
        });
    }
});

app.delete('/api/menu/:id', authenticateToken, requireAdmin, async (req, res) => {
    const {id} = req.params;
    try {
        await pool.query('DELETE FROM menu WHERE id = ?', [id]);
        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 DELETE /api/menu/${id} 에러]`, err);
        res.status(500).json({
            success: false,
            message: '메뉴 삭제 중 오류가 발생했습니다.',
            debug_info: err.message
        });
    }
});


// ---------------------------------------------------------
// [5] API 라우트: 인증 및 사용자 관리 (Auth & Users)
// ---------------------------------------------------------
app.post('/api/register', async (req, res) => {
    const {username, password, name} = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)',
            [username, hashedPassword, name, 'pending']
        );
        res.json({success: true, message: '가입 신청 완료 (관리자에게 가입 승인을 요청하세요.)'});
    } catch (err) {
        console.error(`[🔥 POST /api/register 에러] 시도 아이디: ${username}`, err);
        res.status(500).json({
            success: false,
            message: '중복 아이디 또는 오류 발생',
            debug_info: err.message
        });
    }
});

app.post('/api/login', async (req, res) => {
    const {username, password} = req.body;
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);

        if (users.length === 0 || !(await bcrypt.compare(password, users[0].password))) {
            return res.status(401).json({success: false, message: '아이디/비번 불일치'});
        }

        const user = users[0];
        if (user.role === 'pending') {
            return res.status(403).json({success: false, message: '승인 대기 중입니다.'});
        }

        const token = jwt.sign(
            {id: user.id, username: user.username, role: user.role, name: user.name},
            JWT_SECRET,
            {expiresIn: '12h'}
        );

        res.json({success: true, token, role: user.role, name: user.name, username: user.username, id: user.id});
    } catch (err) {
        console.error(`[🔥 POST /api/login 에러] 시도 아이디: ${username}`, err);
        res.status(500).json({
            success: false,
            message: '서버 에러',
            debug_info: err.message
        });
    }
});

app.patch('/api/users/:id/password', authenticateToken, async (req, res) => {
    const {id} = req.params;
    const {currentPassword, newPassword} = req.body;

    try {
        const [users] = await pool.query('SELECT password FROM users WHERE id = ?', [id]);
        if (users.length === 0) {
            return res.status(404).json({success: false, message: '유저를 찾을 수 없습니다.'});
        }

        const user = users[0];
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(401).json({success: false, message: '현재 비밀번호가 틀렸습니다.'});
        }

        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password = ? WHERE id = ?', [hashedNewPassword, id]);

        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 PATCH /api/users/${id}/password 에러]`, err);
        res.status(500).json({
            success: false,
            message: '서버 에러',
            debug_info: err.message
        });
    }
});

app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, username, name, role, created_at FROM users');
        res.json(rows);
    } catch (err) {
        console.error('[🔥 GET /api/admin/users 에러]', err);
        res.status(500).json({
            success: false,
            message: '유저 목록을 불러오지 못했습니다.',
            debug_info: err.message
        });
    }
});

app.patch('/api/admin/users/:id/role', authenticateToken, requireAdmin, async (req, res) => {
    const {id} = req.params;
    const {role} = req.params;
    try {
        await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, id]);
        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 PATCH /api/admin/users/${id}/role 에러] 변경 시도 역할: ${role}`, err);
        res.status(500).json({
            success: false,
            message: '권한 변경에 실패했습니다.',
            debug_info: err.message
        });
    }
});

app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    const {id} = req.params;
    try {
        await pool.query('DELETE FROM users WHERE id = ?', [id]);
        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 DELETE /api/admin/users/${id} 에러]`, err);
        res.status(500).json({
            success: false,
            message: '계정 삭제 실패',
            debug_info: err.message
        });
    }
});

// ---------------------------------------------------------
// [6] API 라우트: 주문 관리 (Orders)
// ---------------------------------------------------------
app.post('/api/orders', authenticateToken, async (req, res) => {
    const {items, force, paymentMethod, staff_name, applied_event_id, applied_event_qty} = req.body;
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
        if (conn) await conn.rollback();
        console.error(`[🔥 POST /api/orders 에러] 주문자: ${staff_name || '키오스크'}`, error);
        res.status(500).json({
            success: false,
            message: '주문 처리에 실패했습니다.',
            debug_info: error.message
        });
    } finally {
        if (conn) conn.release();
    }
});

app.get('/api/orders', authenticateToken, async (req, res) => {
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

app.patch('/api/orders/:display_id/deliver', authenticateToken, async (req, res) => {
    const {display_id} = req.params;
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

app.patch('/api/orders/:display_id/complete', authenticateToken, async (req, res) => {
    const {display_id} = req.params;
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

app.patch('/api/orders/:display_id/pay', authenticateToken, async (req, res) => {
    const {display_id} = req.params;
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

app.patch('/api/orders/:display_id/complete_kitchen', authenticateToken, async (req, res) => {
    const {display_id} = req.params;
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

app.delete('/api/orders/:display_id', authenticateToken, async (req, res) => {
    const {display_id} = req.params;
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

// ---------------------------------------------------------
// [7] API 라우트: 이벤트 관리 (Events)
// ---------------------------------------------------------
app.get('/api/events', authenticateToken, async (req, res) => {
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
            debug_info: err.message
        });
    }
});

app.post('/api/events', authenticateToken, requireAdmin, async (req, res) => {
    const {name, type, discount_amount, daily_limit, target_menus, is_active} = req.body;
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
            debug_info: err.message
        });
    }
});

app.patch('/api/events/:id/toggle', authenticateToken, requireAdmin, async (req, res) => {
    const {id} = req.params;
    const {is_active} = req.body;
    try {
        await pool.query('UPDATE events SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, id]);
        io.emit('events_updated');
        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 PATCH /api/events/${id} 에러]`, err);
        res.status(500).json({
            success: false,
            message: '이벤트 상태 변경에 실패했습니다.',
            debug_info: err.message
        });
    }
});

app.delete('/api/events/:id', authenticateToken, requireAdmin, async (req, res) => {
    const {id} = req.params;
    try {
        await pool.query('DELETE FROM events WHERE id = ?', [id]);
        io.emit('events_updated');
        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 DELETE /api/events/${id} 에러]`, err);
        res.status(500).json({
            success: false,
            message: '이벤트 삭제에 실패했습니다.',
            debug_info: err.message
        });
    }
});

// ---------------------------------------------------------
// [8] API 라우트: 정산 및 통계 (Settlement & Stats)
// ---------------------------------------------------------
app.get('/api/admin/sales', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM orders WHERE is_paid = 1 ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) {
        console.error('[🔥 GET /api/admin/sales 에러]', err);
        res.status(500).json({
            success: false,
            message: '매출 내역을 불러오지 못했습니다.',
            debug_info: err.message
        });
    }
});

app.delete('/api/admin/sales/:id', authenticateToken, requireAdmin, async (req, res) => {
    const {id} = req.params;
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
            debug_info: err.message
        });
    }
});

app.get('/api/admin/settlements', authenticateToken, requireAdmin, async (req, res) => {
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

app.get('/api/settlement/status', authenticateToken, async (req, res) => {
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

app.post('/api/settlement/open', authenticateToken, async (req, res) => {
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

app.get('/api/settlement/calc', authenticateToken, async (req, res) => {
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

app.post('/api/settlement/close', authenticateToken, async (req, res) => {
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

app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
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
            debug_info: err.message
        });
    }
});

// ---------------------------------------------------------
// [9] API 라우트: 패스키 (WebAuthn)
// ---------------------------------------------------------
const currentChallenges = {}; // 챌린지 임시 저장소

app.get('/api/passkey/register-options', authenticateToken, async (req, res) => {
    const {userId} = req.query;

    try {
        const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
        const [userPasskeys] = await pool.query('SELECT id, transports FROM passkeys WHERE user_id = ?', [userId]);

        if (users.length === 0) return res.status(400).json({error: 'User not found'});
        const user = users[0];

        const options = await generateRegistrationOptions({
            rpName: 'Cafe POS',
            rpID: RP_ID,
            userID: new Uint8Array(Buffer.from(String(user.id))),
            userName: user.username,
            excludeCredentials: userPasskeys.map(key => ({
                id: key.id,
                transports: key.transports ? key.transports.split(',') : []
            })),
            authenticatorSelection: {
                residentKey: 'preferred',
                userVerification: 'preferred',
                authenticatorAttachment: 'platform'
            },
        });

        currentChallenges[userId] = options.challenge;
        // 5분 후 챌린지 자동 삭제 (메모리 관리)
        setTimeout(() => {
            if (currentChallenges[userId]) delete currentChallenges[userId];
        }, 5 * 60 * 1000);

        res.json(options);
    } catch (err) {
        console.error(`[🔥 GET /api/passkey/register-options 에러] 대상 유저 ID: ${userId}`, err);
        res.status(500).json({
            success: false,
            message: '패스키 등록 옵션 생성에 실패했습니다.',
            debug_info: err.message
        });
    }
});

app.post('/api/passkey/register-verify', authenticateToken, async (req, res) => {
    const {userId, body} = req.body;
    const expectedChallenge = currentChallenges[userId];

    if (!expectedChallenge) {
        return res.status(400).json({error: 'Challenge not found'});
    }

    try {
        const verification = await verifyRegistrationResponse({
            response: body,
            expectedChallenge,
            expectedOrigin: EXPECTED_ORIGIN,
            expectedRPID: RP_ID,
        });

        if (verification.verified && verification.registrationInfo) {
            const {credential} = verification.registrationInfo;
            // 기기 이름 추정 로직
            const userAgent = req.get('User-Agent') || '';
            let deviceName = '기타 기기';
            if (userAgent.includes('Mac')) deviceName = 'Mac';
            else if (userAgent.includes('Windows')) deviceName = 'Windows PC';
            else if (userAgent.includes('iPhone')) deviceName = 'iPhone';
            else if (userAgent.includes('Android')) deviceName = 'Android';
            else if (userAgent.includes('Linux')) deviceName = 'Linux';

            if (userAgent.includes('Chrome')) deviceName += ' (Chrome)';
            else if (userAgent.includes('Safari')) deviceName += ' (Safari)';
            else if (userAgent.includes('Edg')) deviceName += ' (Edge)';
            else if (userAgent.includes('Firefox')) deviceName += ' (Firefox)';

            await pool.query(
                `INSERT INTO passkeys (id, public_key, counter, user_id, transports, device_name)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    String(credential.id),
                    Buffer.from(credential.publicKey).toString('base64'),
                    credential.counter,
                    userId,
                    'internal',
                    deviceName
                ]
            );

            delete currentChallenges[userId];
            res.json({success: true});
        } else {
            res.status(400).json({success: false, message: '패스키 검증에 실패했습니다.'});
        }
    } catch (error) {
        console.error(`[🔥 POST /api/passkey/register-verify 에러] 대상 유저 ID: ${userId}`, error);
        res.status(500).json({
            success: false,
            message: '패스키 등록 검증 중 서버 오류가 발생했습니다.',
            debug_info: error.message
        });
    }
});

app.get('/api/passkey/login-options', async (req, res) => {
    try {
        const options = await generateAuthenticationOptions({
            rpID: RP_ID,
            userVerification: 'preferred',
        });
        currentChallenges[options.challenge] = options.challenge;
        res.json(options);
    } catch (err) {
        console.error('[🔥 GET /api/passkey/login-options 에러]', err);
        res.status(500).json({
            success: false,
            message: '패스키 로그인 옵션 생성에 실패했습니다.',
            debug_info: err.message
        });
    }
});

app.post('/api/passkey/login-verify', async (req, res) => {
    const {body} = req.body;

    try {
        const [rows] = await pool.query('SELECT * FROM passkeys WHERE id = ?', [body.id]);
        if (rows.length === 0) {
            return res.status(400).json({error: 'Passkey not found'});
        }

        const passkey = rows[0];
        const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [passkey['user_id']]);

        const user = users[0];
        const verification = await verifyAuthenticationResponse({
            response: body,
            expectedChallenge: (challenge) => {
                if (currentChallenges[challenge]) {
                    delete currentChallenges[challenge];
                    return true;
                }
                return false;
            },
            expectedOrigin: EXPECTED_ORIGIN,
            expectedRPID: RP_ID,
            credential: {
                id: passkey.id,
                publicKey: new Uint8Array(Buffer.from(passkey['public_key'], 'base64')),
                counter: Number(passkey.counter),
                transports: passkey.transports ? passkey.transports.split(',') : [],
            },
            requireUserVerification: false,
        });

        if (verification.verified) {
            await pool.query('UPDATE passkeys SET counter = ? WHERE id = ?', [verification.authenticationInfo.newCounter, passkey.id]);

            const token = jwt.sign({
                id: user.id,
                username: user.username,
                role: user.role,
                name: user.name
            }, JWT_SECRET, {expiresIn: '12h'});
            res.json({success: true, token, role: user.role, name: user.name, username: user.username, id: user.id});
        } else {
            res.status(400).json({success: false, message: '패스키 로그인 검증에 실패했습니다.'});
        }
    } catch (error) {
        console.error('[🔥 POST /api/passkey/login-verify 에러]', error);
        res.status(400).json({
            success: false,
            message: '로그인 검증 중 오류가 발생했습니다.',
            debug_info: error.message
        });
    }
});

app.get('/api/passkeys', authenticateToken, async (req, res) => {
    const {userId} = req.query;
    try {
        const [rows] = await pool.query(
            'SELECT id, device_name, created_at FROM passkeys WHERE user_id = ? ORDER BY created_at DESC',
            [userId]
        );
        res.json(rows);
    } catch (err) {
        console.error(`[🔥 GET /api/passkeys 에러] 대상 유저 ID: ${userId}`, err);
        res.status(500).json({
            success: false,
            message: '패스키 목록 조회에 실패했습니다.',
            debug_info: err.message
        });
    }
});

app.delete('/api/passkeys/:id', authenticateToken, async (req, res) => {
    const {id} = req.params;
    try {
        await pool.query('DELETE FROM passkeys WHERE id = ?', [id]);
        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 DELETE /api/passkeys/${id} 에러]`, err);
        res.status(500).json({
            success: false,
            message: '패스키 삭제에 실패했습니다.',
            debug_info: err.message
        });
    }
});

// ---------------------------------------------------------
// [10] 단순 응답 확인용
// ---------------------------------------------------------
app.get('/ping', (req, res) => {
    res.status(200).send('pong');
});

// ---------------------------------------------------------
// [11] Socket.IO 및 서버 시작
// ---------------------------------------------------------
let currentCashierId = null;
const connectedUsers = new Map();
const kitchenUsers = new Set();

io.on('connection', (socket) => {
    console.log(`[🟢 Socket 연결됨] ID: ${socket.id} (현재 접속자: ${io.engine.clientsCount}명)`);

    socket.on('register_user', (data) => {
        connectedUsers.set(socket.id, data);
        console.log(`[👤 유저 등록] ${data.username} (ID: ${socket.id})`);
        broadcastUserCount();
    });

    socket.on('claim_cashier', () => {
        if (currentCashierId === null) {
            currentCashierId = socket.id;
            console.log(`[🛒 캐셔 선점] ID: ${socket.id}`);
            io.emit('cashier_status', true);
            socket.emit('cashier_claimed', true);
        } else {
            console.log(`[⚠️ 캐셔 선점 실패] ID: ${socket.id} (이미 사용 중)`);
            socket.emit('cashier_claimed', false);
        }
    });

    socket.on('release_cashier', () => {
        if (socket.id === currentCashierId) {
            currentCashierId = null;
            console.log(`[🔓 캐셔 해제] ID: ${socket.id}가 캐셔 자리를 반납함`);
            io.emit('cashier_status', false);
        }
    });

    socket.on('request_state', () => {
        socket.emit('cashier_status', currentCashierId !== null);
        socket.emit('kitchen_status', kitchenUsers.size > 0); // 주방 상태도 꼭 알려줘야 함!
    });

    socket.on('join_kitchen', () => {
        kitchenUsers.add(socket.id);
        io.emit('kitchen_status', kitchenUsers.size > 0);
        console.log(`[🍳 주방 입장] ID: ${socket.id} (현재 주방 인원: ${kitchenUsers.size}명)`);
    });

    socket.on('leave_kitchen', () => {
        kitchenUsers.delete(socket.id);
        io.emit('kitchen_status', kitchenUsers.size > 0);
    });

    socket.on('logout', () => {
        const user = connectedUsers.get(socket.id);
        console.log(`[👋 로그아웃] ${user?.username || '알 수 없음'} (ID: ${socket.id})`);
        connectedUsers.delete(socket.id);
        broadcastUserCount();
    });

    socket.on('disconnect', (reason) => {
        console.log(`[🔴 Socket 끊김] ID: ${socket.id}, 사유: ${reason}`);

        connectedUsers.delete(socket.id);
        broadcastUserCount();

        if (socket.id === currentCashierId) {
            currentCashierId = null;
            console.log(`[🔓 캐셔 자동 해제] 사유: 캐셔 담당자의 연결 끊김`);
            io.emit('cashier_status', false);
        }

        if (kitchenUsers.has(socket.id)) {
            kitchenUsers.delete(socket.id);
            io.emit('kitchen_status', kitchenUsers.size > 0);
            console.log(`[🍳 주방 퇴장 (연결 끊김)] 남은 주방 인원: ${kitchenUsers.size}명`);
        }
    });

    socket.on('error', (err) => {
        console.error(`[❌ Socket 에러] ID: ${socket.id}, 에러 상세:`, err);
    });

    function broadcastUserCount() {
        const staffUsers = Array.from(connectedUsers.values()).filter(user => user.role !== 'admin');
        const uniqueStaffCount = new Set(staffUsers.map(u => u.username)).size;
        io.emit('user_count', uniqueStaffCount);
    }
});

server.listen(PORT, () => {
    const serverUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

    const env = process.env.NODE_ENV === 'production' ? '☁️ 운영(Production)' : '💻 개발(Local)';

    console.log(`=================================`);
    console.log(`🚀 [서버 실행됨] ${env}`);
    console.log(`🔗 주소: ${serverUrl}`);
    console.log(`=================================`);
});