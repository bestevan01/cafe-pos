const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
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

// --- [Configuration] ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 8080;
const JWT_SECRET = "REMOVED_SECRET";
const FRONTEND_URL = 'bu-cafe-pos.vercel.app'; // Vercel 배포 주소
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// WebAuthn(패스키) 설정
const RP_ID = IS_PRODUCTION ? FRONTEND_URL : 'localhost';
const EXPECTED_ORIGIN = IS_PRODUCTION ? `https://${FRONTEND_URL}` : 'http://localhost:5173';

// Middleware
app.use(cors({ origin: "*", methods: ["GET", "POST", "PATCH", "PUT", "DELETE"] }));
app.use(express.json());

// --- [Database Connection] ---
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || "REMOVED_SECRET",
    database: process.env.DB_NAME || 'cafe_db',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: IS_PRODUCTION }
});

pool.getConnection()
    .then(conn => { console.log("✅ Database Connected!"); conn.release(); })
    .catch(err => { console.error("❌ Database Connection Failed:", err); });


// ==========================================
// [SECTION 1] Menu API
// ==========================================

app.get('/api/menu', async (req, res) => {
    try {
        const conn = await pool.getConnection();
        const [rows] = await conn.query('SELECT * FROM menu');
        conn.release();
        res.json(rows);
    } catch (err) {
        res.status(500).json({ success: false, message: '메뉴 로드 실패' });
    }
});

app.post('/api/menu', async (req, res) => {
    const { name, price, type } = req.body;
    try {
        const conn = await pool.getConnection();
        await conn.query('INSERT INTO menu (name, price, type) VALUES (?, ?, ?)', [name, price, type]);
        conn.release();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.patch('/api/menu/:id', async (req, res) => {
    const { id } = req.params;
    const { name, price, type, is_soldout } = req.body;
    let fields = [], values = [];

    if (name) { fields.push('name = ?'); values.push(name); }
    if (price) { fields.push('price = ?'); values.push(price); }
    if (type) { fields.push('type = ?'); values.push(type); }
    if (is_soldout !== undefined) { fields.push('is_soldout = ?'); values.push(is_soldout); }
    values.push(id);

    try {
        const conn = await pool.getConnection();
        if (fields.length > 0) {
            await conn.query(`UPDATE menu SET ${fields.join(', ')} WHERE id = ?`, values);
        }
        conn.release();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.delete('/api/menu/:id', async (req, res) => {
    try {
        const conn = await pool.getConnection();
        await conn.query('DELETE FROM menu WHERE id = ?', [req.params.id]);
        conn.release();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});


// ==========================================
// [SECTION 2] Auth & Admin API
// ==========================================

app.post('/api/register', async (req, res) => {
    const { username, password, name } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const conn = await pool.getConnection();
        await conn.query(
            'INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)',
            [username, hashedPassword, name, 'pending']
        );
        conn.release();
        res.json({ success: true, message: '가입 신청 완료 (승인 대기)' });
    } catch (err) {
        res.status(500).json({ success: false, message: '중복 아이디 또는 오류 발생' });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const conn = await pool.getConnection();
        const [users] = await conn.query('SELECT * FROM users WHERE username = ?', [username]);
        conn.release();

        if (users.length === 0 || !(await bcrypt.compare(password, users[0].password))) {
            return res.status(401).json({ success: false, message: '아이디/비번 불일치' });
        }

        const user = users[0];
        if (user.role === 'pending') {
            return res.status(403).json({ success: false, message: '승인 대기 중입니다.' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, name: user.name },
            JWT_SECRET,
            { expiresIn: '12h' }
        );

        res.json({ success: true, token, role: user.role, name: user.name, username: user.username, id: user.id });
    } catch (err) {
        res.status(500).json({ success: false, message: '서버 에러' });
    }
});

app.patch('/api/users/:id/password', async (req, res) => {
    const { id } = req.params;
    const { currentPassword, newPassword } = req.body;

    const conn = await pool.getConnection();
    try {
        // 1. 현재 유저 정보(비밀번호 해시) 가져오기
        const [users] = await conn.query('SELECT password FROM users WHERE id = ?', [id]);
        if (users.length === 0) {
            conn.release();
            return res.status(404).json({ success: false, message: '유저를 찾을 수 없습니다.' });
        }

        const user = users[0];

        // 2. 현재 비밀번호가 맞는지 확인
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            conn.release();
            return res.status(401).json({ success: false, message: '현재 비밀번호가 틀렸습니다.' });
        }

        // 3. 새 비밀번호 암호화 및 업데이트
        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        await conn.query('UPDATE users SET password = ? WHERE id = ?', [hashedNewPassword, id]);

        conn.release();
        res.json({ success: true });

    } catch (err) {
        if (conn) conn.release();
        console.error(err);
        res.status(500).json({ success: false, message: '서버 에러' });
    }
});

app.get('/api/admin/users', async (req, res) => {
    const conn = await pool.getConnection();
    const [rows] = await conn.query('SELECT id, username, name, role, created_at FROM users');
    conn.release();
    res.json(rows);
});

app.patch('/api/admin/users/:id/role', async (req, res) => {
    try {
        const conn = await pool.getConnection();
        await conn.query('UPDATE users SET role = ? WHERE id = ?', [req.body.role, req.params.id]);
        conn.release();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});


// ==========================================
// [SECTION 3] Order Handling API
// ==========================================

app.post('/api/orders', async (req, res) => {
    const { items, force, paymentMethod, staff_name } = req.body;
    const conn = await pool.getConnection();

    try {
        await conn.beginTransaction();

        // 중복 체크
        if (!force && items.length > 0) {
            const [rows] = await conn.query(`
                SELECT * FROM orders WHERE menu_name = ? AND quantity = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 MINUTE)
            `, [items[0].menu_name, items[0].quantity]);

            if (rows.length > 0) {
                conn.release();
                return res.json({ success: false, isDuplicate: true });
            }
        }

        // 번호표 생성
        const [rows] = await conn.query(`SELECT MAX(daily_number) as maxNum FROM orders WHERE DATE(created_at) = CURDATE()`);
        const nextDailyNum = (rows[0].maxNum || 0) + 1;

        const today = new Date();
        const formattedID = `${today.toISOString().slice(0, 10).replace(/-/g, "")}-${String(nextDailyNum).padStart(3, "0")}`;

        // 주문 저장
        for (const item of items) {
            await conn.query(
                `INSERT INTO orders (menu_name, quantity, total_price, daily_number, display_id, payment_method, staff_name) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [item.menu_name, item.quantity, item.price * item.quantity, nextDailyNum, formattedID, paymentMethod || 'cash', staff_name || '키오스크']
            );
        }

        await conn.commit();

        io.emit('new_order', {
            display_id: formattedID,
            daily_number: String(nextDailyNum).padStart(3, "0"),
            items: items.map(i => ({ menu_name: i.menu_name, quantity: i.quantity, price: i.price * i.quantity })),
            created_at: new Date(),
            payment_method: paymentMethod || 'cash',
            staff_name: staff_name || '키오스크',
            is_paid: 0
        });

        res.json({ success: true });
    } catch (error) {
        await conn.rollback();
        res.status(500).json({ success: false, message: '주문 실패' });
    } finally {
        conn.release();
    }
});

app.get('/api/orders', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM orders WHERE is_delivered = 0 ORDER BY id DESC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

app.patch('/api/orders/:display_id/deliver', async (req, res) => {
    const { display_id } = req.params;
    const conn = await pool.getConnection();
    try {
        await conn.query('UPDATE orders SET is_delivered = 1 WHERE display_id = ?', [display_id]);
        const [rows] = await conn.query('SELECT is_paid, is_completed FROM orders WHERE display_id = ? LIMIT 1', [display_id]);

        io.emit('order_updated', { display_id, ...rows[0], is_delivered: 1 });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
    finally { conn.release(); }
});

app.patch('/api/orders/:display_id/complete', async (req, res) => {
    const { display_id } = req.params;
    const conn = await pool.getConnection();
    try {
        await conn.query('UPDATE orders SET is_paid = 1, is_completed = 1, payment_method = ? WHERE display_id = ?', [req.body.paymentMethod || 'cash', display_id]);
        io.emit('order_updated', { display_id, is_paid: 1, is_completed: 1 });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
    finally { conn.release(); }
});

app.patch('/api/orders/:display_id/pay', async (req, res) => {
    const { display_id } = req.params;
    const conn = await pool.getConnection();
    try {
        await conn.query('UPDATE orders SET is_paid = 1, payment_method = ? WHERE display_id = ?', [req.body.paymentMethod || 'cash', display_id]);
        const [rows] = await conn.query('SELECT is_completed FROM orders WHERE display_id = ? LIMIT 1', [display_id]);

        io.emit('order_updated', { display_id, is_paid: 1, is_completed: rows[0]?.is_completed || 0 });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
    finally { conn.release(); }
});

app.patch('/api/orders/:display_id/complete_kitchen', async (req, res) => {
    const { display_id } = req.params;
    const conn = await pool.getConnection();
    try {
        await conn.query('UPDATE orders SET is_completed = 1 WHERE display_id = ?', [display_id]);
        io.emit('order_updated', { display_id, is_completed: 1 });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
    finally { conn.release(); }
});

app.delete('/api/orders/:display_id', async (req, res) => {
    const { display_id } = req.params;
    const conn = await pool.getConnection();
    try {
        await conn.query('DELETE FROM orders WHERE display_id = ?', [display_id]);
        io.emit('order_deleted', display_id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
    finally { conn.release(); }
});


// ==========================================
// [SECTION 4] Settlement & Stats API
// ==========================================

app.get('/api/admin/sales', async (req, res) => {
    const conn = await pool.getConnection();
    const [rows] = await conn.query('SELECT * FROM orders WHERE is_paid = 1 ORDER BY created_at DESC');
    conn.release();
    res.json(rows);
});

app.delete('/api/admin/sales/:id', async (req, res) => {
    const conn = await pool.getConnection();
    await conn.query('DELETE FROM orders WHERE id = ?', [req.params.id]);
    conn.release();
    res.json({ success: true });
});

app.get('/api/admin/settlements', async (req, res) => {
    const conn = await pool.getConnection();
    const [rows] = await conn.query('SELECT * FROM cash_settlements ORDER BY date DESC');
    conn.release();
    res.json(rows);
});

app.get('/api/settlement/status', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const [todayRows] = await conn.query('SELECT * FROM cash_settlements WHERE date = CURDATE()');
        if (todayRows.length === 0) {
            const [prevRows] = await conn.query('SELECT closing_amount FROM cash_settlements WHERE is_closed = 1 ORDER BY date DESC, id DESC LIMIT 1');
            const prevClosing = prevRows.length > 0 ? Number(prevRows[0].closing_amount) : 0;
            res.json({ status: 'not_opened', prevClosing });
        } else {
            res.json({ status: todayRows[0].is_closed ? 'closed' : 'opened', data: todayRows[0] });
        }
    } catch (err) { res.status(500).json({ success: false }); }
    finally { conn.release(); }
});

app.post('/api/settlement/open', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.query('INSERT INTO cash_settlements (date, opening_amount) VALUES (CURDATE(), ?)', [req.body.amount]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
    finally { conn.release(); }
});

app.get('/api/settlement/calc', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const [settlement] = await conn.query('SELECT opening_amount FROM cash_settlements WHERE date = CURDATE()');
        if (settlement.length === 0) return res.status(400).json({ message: "미오픈 상태" });

        const [orders] = await conn.query(`SELECT IFNULL(SUM(total_price), 0) as cash_sales FROM orders WHERE is_paid = 1 AND payment_method = 'cash' AND DATE(created_at) = CURDATE()`);
        const opening = settlement[0].opening_amount;
        const cashSales = parseInt(orders[0].cash_sales);

        res.json({ opening, sales: cashSales, expected: opening + cashSales });
    } catch (err) { res.status(500).json({ success: false }); }
    finally { conn.release(); }
});

app.post('/api/settlement/close', async (req, res) => {
    const { closingAmount, salesCash, diff } = req.body;
    const conn = await pool.getConnection();
    try {
        await conn.query(
            `UPDATE cash_settlements SET closing_amount = ?, sales_cash = ?, difference = ?, is_closed = 1 WHERE date = CURDATE()`,
            [closingAmount, salesCash, diff]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
    finally { conn.release(); }
});

app.get('/api/admin/stats', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const [itemRows] = await conn.query(`SELECT menu_name, SUM(quantity) as total_qty, SUM(total_price) as total_sales FROM orders WHERE is_paid = 1 GROUP BY menu_name ORDER BY total_sales DESC`);
        const [timeRows] = await conn.query(`SELECT HOUR(created_at) as hour, COUNT(*) as order_count, SUM(total_price) as total_sales FROM orders WHERE is_paid = 1 GROUP BY HOUR(created_at) ORDER BY hour ASC`);
        res.json({ itemStats: itemRows, timeStats: timeRows });
    } catch (err) { res.status(500).json({ success: false }); }
    finally { conn.release(); }
});


// ==========================================
// [SECTION 5] Passkey (WebAuthn) API
// ==========================================

const currentChallenges = {}; // In-memory storage

app.get('/api/passkey/register-options', async (req, res) => {
    const { userId } = req.query;
    const conn = await pool.getConnection();

    try {
        const [users] = await conn.query('SELECT * FROM users WHERE id = ?', [userId]);
        const [userPasskeys] = await conn.query('SELECT id FROM passkeys WHERE user_id = ?', [userId]);
        conn.release();

        if (users.length === 0) return res.status(400).json({ error: 'User not found' });
        const user = users[0];

        const options = await generateRegistrationOptions({
            rpName: 'Cafe POS',
            rpID: RP_ID,
            userID: new Uint8Array(Buffer.from(String(user.id))),
            userName: user.username,
            excludeCredentials: userPasskeys.map(key => ({ id: key.id, transports: key.transports ? key.transports.split(',') : [] })),
            authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred', authenticatorAttachment: 'platform' },
        });

        currentChallenges[userId] = options.challenge;
        res.json(options);
    } catch (err) {
        if(conn) conn.release();
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/passkey/register-verify', async (req, res) => {
    const { userId, body } = req.body;
    const expectedChallenge = currentChallenges[userId];
    if (!expectedChallenge) return res.status(400).json({ error: 'Challenge not found' });

    try {
        const verification = await verifyRegistrationResponse({
            response: body,
            expectedChallenge,
            expectedOrigin: EXPECTED_ORIGIN,
            expectedRPID: RP_ID,
        });

        if (verification.verified && verification.registrationInfo) {
            const { credential } = verification.registrationInfo;

            const userAgent = req.get('User-Agent') || '';
            let deviceName = '기타 기기';

            if (userAgent.includes('Mac')) deviceName = 'Mac';
            else if (userAgent.includes('Windows')) deviceName = 'Windows PC';
            else if (userAgent.includes('iPhone')) deviceName = 'iPhone';
            else if (userAgent.includes('Android')) deviceName = 'Android';
            else if (userAgent.includes('Linux')) deviceName = 'Linux';

            if (userAgent.includes('Chrome')) deviceName += ' (Chrome)';
            else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) deviceName += ' (Safari)';
            else if (userAgent.includes('Edg')) deviceName += ' (Edge)';
            else if (userAgent.includes('Firefox')) deviceName += ' (Firefox)';

            const conn = await pool.getConnection();
            await conn.query(
                `INSERT INTO passkeys (id, public_key, counter, user_id, transports, device_name) VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    String(credential.id),
                    Buffer.from(credential.publicKey).toString('base64'),
                    credential.counter,
                    userId,
                    'internal',
                    deviceName
                ]
            );
            conn.release();
            delete currentChallenges[userId];
            res.json({ success: true });
        } else {
            res.status(400).json({ success: false, message: 'Verification failed' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/passkey/login-options', async (req, res) => {
    const options = await generateAuthenticationOptions({
        rpID: RP_ID,
        userVerification: 'preferred',
    });
    currentChallenges[options.challenge] = options.challenge;
    res.json(options);
});

app.post('/api/passkey/login-verify', async (req, res) => {
    const { body } = req.body;
    const conn = await pool.getConnection();

    try {
        const [rows] = await conn.query('SELECT * FROM passkeys WHERE id = ?', [body.id]);
        if (rows.length === 0) { conn.release(); return res.status(400).json({ error: 'Passkey not found' }); }

        const passkey = rows[0];
        const [users] = await conn.query('SELECT * FROM users WHERE id = ?', [passkey.user_id]);
        conn.release();

        const user = users[0];
        const verification = await verifyAuthenticationResponse({
            response: body,
            expectedChallenge: () => true,
            expectedOrigin: EXPECTED_ORIGIN,
            expectedRPID: RP_ID,
            credential: {
                id: passkey.id,
                publicKey: new Uint8Array(Buffer.from(passkey.public_key, 'base64')),
                counter: Number(passkey.counter),
                transports: passkey.transports ? passkey.transports.split(',') : [],
            },
            requireUserVerification: false,
        });

        if (verification.verified) {
            const conn2 = await pool.getConnection();
            await conn2.query('UPDATE passkeys SET counter = ? WHERE id = ?', [verification.authenticationInfo.newCounter, passkey.id]);
            conn2.release();

            const token = jwt.sign({ id: user.id, username: user.username, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '12h' });
            res.json({ success: true, token, role: user.role, name: user.name, username: user.username, id: user.id });
        } else {
            res.status(400).json({ success: false, message: 'Verification failed' });
        }
    } catch (error) {
        if(conn) conn.release();
        res.status(400).json({ error: error.message });
    }
});

app.get('/api/passkeys', async (req, res) => {
    const { userId } = req.query;
    try {
        const conn = await pool.getConnection();
        const [rows] = await conn.query(
            'SELECT id, device_name, created_at FROM passkeys WHERE user_id = ? ORDER BY created_at DESC',
            [userId]
        );
        conn.release();
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: '목록 조회 실패' });
    }
});

app.delete('/api/passkeys/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const conn = await pool.getConnection();
        await conn.query('DELETE FROM passkeys WHERE id = ?', [id]);
        conn.release();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: '삭제 실패' });
    }
});


// ==========================================
// [SECTION 6] Socket.IO & Server Start
// ==========================================

let currentCashierId = null;
const connectedUsers = new Map();

io.on('connection', (socket) => {
    console.log(`🔌 Client Connected: ${socket.id}`);

    socket.on('register_user', (data) => {
        connectedUsers.set(socket.id, data);
        broadcastUserCount();
    });

    socket.on('claim_cashier', () => {
        if (currentCashierId === null) {
            currentCashierId = socket.id;
            io.emit('cashier_status', true);
            socket.emit('cashier_claimed', true);
        } else {
            socket.emit('cashier_claimed', false);
        }
    });

    socket.on('release_cashier', () => {
        if (socket.id === currentCashierId) {
            currentCashierId = null;
            io.emit('cashier_status', false);
        }
    });

    socket.on('logout', () => {
        connectedUsers.delete(socket.id);
        broadcastUserCount();
    });

    socket.on('disconnect', () => {
        connectedUsers.delete(socket.id);
        broadcastUserCount();
        if (socket.id === currentCashierId) {
            currentCashierId = null;
            io.emit('cashier_status', false);
        }
    });

    function broadcastUserCount() {
        const staffUsers = Array.from(connectedUsers.values()).filter(user => user.role !== 'admin');
        const uniqueStaffCount = new Set(staffUsers.map(u => u.username)).size;
        io.emit('user_count', uniqueStaffCount);
    }
});

server.listen(PORT, () => {
    console.log(`🚀 Server Running: http://localhost:${PORT}`);
});

// Render Keep-Alive
setInterval(() => {
    if (IS_PRODUCTION) {
        https.get('https://cafe-server-0qur.onrender.com', (res) => {
            // Self-ping to prevent sleep
        }).on('error', (err) => {});
    }
}, 600000);