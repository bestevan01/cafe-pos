const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const cors = require('cors');
const mysql = require('mysql2/promise'); // mysql2 도구 불러오기
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse
} = require('@simplewebauthn/server');
// const {socket} = require("../src/socket");

const JWT_SECRET = "REMOVED_SECRET";

const app = express();

const FRONTEND_URL = 'bu-cafe-pos.vercel.app';

const RP_ID = process.env.NODE_ENV === 'production' ? FRONTEND_URL : 'localhost';

const EXPECTED_ORIGIN = process.env.NODE_ENV === 'production'
    ? `https://${FRONTEND_URL}`
    : 'http://localhost:5173';

app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"] }));
app.use(express.json()); // 프론트에서 보내는 JSON 데이터를 읽을 수 있게 설정

// 1. 메뉴 목록 가져오기
app.get('/api/menu', async (req, res) => {
    try {
        const conn = await pool.getConnection();
        const [rows] = await conn.query('SELECT * FROM menu');
        conn.release();
        res.json(rows);
    } catch (err) {
        res.status(500).json({ success: false, message: '메뉴 불러오기 실패' });
    }
});

// 2. 메뉴 추가 (관리자용)
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

// 3. 메뉴 수정/품절처리 (관리자용)
app.patch('/api/menu/:id', async (req, res) => {
    const { id } = req.params;
    const { name, price, type, is_soldout } = req.body;

    let fields = [];
    let values = [];

    if (name) { fields.push('name = ?'); values.push(name); }
    if (price) { fields.push('price = ?'); values.push(price); }
    if (type) { fields.push('type = ?'); values.push(type); }
    if (is_soldout !== undefined) { fields.push('is_soldout = ?'); values.push(is_soldout); }

    values.push(id);

    try {
        const conn = await pool.getConnection();
        if (fields.length === 0) return res.json({ success: true });
        await conn.query(`UPDATE menu SET ${fields.join(', ')} WHERE id = ?`, values);
        conn.release();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// 4. 메뉴 삭제 (관리자용)
app.delete('/api/menu/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const conn = await pool.getConnection();
        await conn.query('DELETE FROM menu WHERE id = ?', [id]);
        conn.release();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// --- [회원가입 API] ---
app.post('/api/register', async (req, res) => {
    const { username, password, name } = req.body;
    try {
        // 1. 비밀번호 암호화
        const hashedPassword = await bcrypt.hash(password, 10);

        // 2. DB 저장 (기본 권한은 'pending')
        const conn = await pool.getConnection();
        await conn.query(
            'INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)',
            [username, hashedPassword, name, 'pending']
        );
        conn.release();

        res.json({ success: true, message: '회원가입 신청 완료! 관리자 승인을 기다리세요.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '중복된 아이디거나 에러가 발생했습니다.' });
    }
});

// --- [로그인 API] ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const conn = await pool.getConnection();
        const [users] = await conn.query('SELECT * FROM users WHERE username = ?', [username]);
        conn.release();

        // 유저가 없거나 비밀번호가 틀리면
        if (users.length === 0 || !(await bcrypt.compare(password, users[0].password))) {
            return res.status(401).json({ success: false, message: '아이디 또는 비번이 틀렸습니다.' });
        }

        const user = users[0];

        // 승인 대기중인 경우 차단
        if (user.role === 'pending') {
            return res.status(403).json({ success: false, message: '관리자 승인 대기 중입니다.' });
        }

        // 로그인 성공! 토큰(출입증) 발급
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, name: user.name },
            JWT_SECRET,
            { expiresIn: '12h' } // 12시간 유효
        );

        res.json({
            success: true,
            token,
            role: user.role,
            name: user.name,
            username: user.username, // 👈 이거 추가!
            id: user.id
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '서버 에러' });
    }
});

// --- [관리자용: 회원 목록 조회 API] ---
app.get('/api/admin/users', async (req, res) => {
    // 실제로는 여기서 토큰 검사를 해야 하지만 일단 생략
    const conn = await pool.getConnection();
    const [rows] = await conn.query('SELECT id, username, name, role, created_at FROM users');
    conn.release();
    res.json(rows);
});

// --- [관리자용: 회원 승인/권한수정 API] ---
app.patch('/api/admin/users/:id/role', async (req, res) => {
    const { id } = req.params;
    const { role } = req.body; // 'staff' or 'admin' or 'pending'

    try {
        const conn = await pool.getConnection();
        await conn.query('UPDATE users SET role = ? WHERE id = ?', [role, id]);
        conn.release();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const isProduction = process.env.NODE_ENV === "production";

// 1. 데이터베이스 연결 설정 (본인 환경에 맞게 수정 필요!)
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',      // MariaDB 설치 시 기본 아이디
    password: process.env.DB_PASSWORD || "REMOVED_SECRET",      // 비밀번호 (설정 안 했으면 빈칸 '' 그대로, 설정했으면 입력)
    database: process.env.DB_NAME || 'cafe_db', // 아까 만든 DB 이름
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: isProduction
    }
});

// 2. DB 연결 테스트
// noinspection JSVoidFunctionReturnValueUsed
pool.getConnection()
    .then(conn => {
        console.log("✅ MariaDB 연결 성공!");
        conn.release();
    })
    .catch(err => {
        console.error("❌ DB 연결 실패. 비밀번호나 DB명을 확인하세요.", err);
    });


// 3. [주문 받기 API] 프론트에서 주문이 들어오면 여기로 옵니다.
// [주문 받기 API] - 여러 메뉴를 한 번에 받아서 저장 (Bulk Insert)
app.post('/api/orders', async (req, res) => {
    // items는 배열입니다. 예: [{menu_name: '아아', quantity: 2}, {menu_name: '라떼', quantity: 1}]
    const { items, force, paymentMethod, staff_name } = req.body;

    const conn = await pool.getConnection();

    try {
        await conn.beginTransaction(); // 트랜잭션 시작

        // 1. [중복 체크] (첫 번째 메뉴 기준으로 1분 내 중복 체크)
        if (!force && items.length > 0) {
            const firstMenu = items[0].menu_name;
            const firstQty = items[0].quantity;

            const [rows] = await conn.query(`
                SELECT * FROM orders 
                WHERE menu_name = ? 
                AND quantity = ?
                AND created_at > DATE_SUB(NOW(), INTERVAL 1 MINUTE)
            `, [firstMenu, firstQty]);

            if (rows.length > 0) {
                conn.release();
                return res.json({ success: false, isDuplicate: true });
            }
        }

        // 2. [번호표 뽑기] (주문 묶음 전체에 대해 딱 1번만 수행)
        const [rows] = await conn.query(`
            SELECT MAX(daily_number) as maxNum
            FROM orders
            WHERE DATE(created_at) = CURDATE()
        `);
        const nextDailyNum = (rows[0].maxNum || 0) + 1;

        // ID 포맷팅 (YYYYMMDD-###)
        const today = new Date();
        const yyyymmdd = today.toISOString().slice(0, 10).replace(/-/g, "");
        const seqNum = String(nextDailyNum).padStart(3, "0");
        const formattedID = `${yyyymmdd}-${seqNum}`;

        // 3. [일괄 저장] 반복문으로 모든 메뉴를 DB에 넣음
        // 주의: 모든 메뉴가 같은 daily_number와 formattedID를 가짐
        for (const item of items) {
            const sql = `INSERT INTO orders (menu_name, quantity, total_price, daily_number, display_id, payment_method, staff_name) VALUES (?, ?, ?, ?, ?, ?, ?)`;

            const lineTotal = item.price * item.quantity;

            await conn.query(sql, [item.menu_name, item.quantity, lineTotal, nextDailyNum, formattedID, paymentMethod || 'cash', staff_name || '키오스크']);
        }

        await conn.commit(); // DB 반영

        const socketItems = items.map(i => ({
            menu_name: i.menu_name,
            quantity: i.quantity,
            price: i.price * i.quantity // 단가 * 수량 = 총액
        }));

        // 4. 소켓 전송 (프론트엔드에게 보낼 데이터 정제)
        // 묶음 주문 정보를 보냅니다.
        const newOrderGroup = {
            display_id: formattedID,
            daily_number: seqNum,
            items: socketItems, // 주문한 메뉴 리스트
            created_at: new Date(),
            payment_method: paymentMethod || 'cash',
            staff_name: staff_name || '키오스크',
            is_paid: 0
        };

        io.emit('new_order', newOrderGroup);
        res.json({ success: true });

    } catch (error) {
        await conn.rollback();
        console.error(error);
        res.status(500).json({ success: false, message: '서버 오류' });
    } finally {
        conn.release();
    }
});

// 4. [주문 목록 조회 API] 앱 켰을 때 기존 주문들 불러오기
app.get('/api/orders', async (req, res) => {
    try {
        // 아직 완료되지 않은 주문만 가져옵니다. (완료된 건 장부에서 숨김)
        const [rows] = await pool.query(`
            SELECT * FROM orders
            WHERE is_delivered = 0
            ORDER BY id DESC
        `);
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: '조회 실패' });
    }
});

app.patch('/api/orders/:display_id/deliver', async (req, res) => {
    const { display_id } = req.params;

    const conn = await pool.getConnection();
    try {
        // 1. is_delivered를 1로 변경
        await conn.query(`UPDATE orders SET is_delivered = 1 WHERE display_id = ?`, [display_id]);

        // 2. 현재 상태(입금, 조리)도 같이 조회해서 정확하게 알림
        const [rows] = await conn.query(`SELECT is_paid, is_completed FROM orders WHERE display_id = ? LIMIT 1`, [display_id]);
        const { is_paid, is_completed } = rows[0];

        // 3. 방송: "야! 이거 손님한테 나갔어!(Delivered)"
        io.emit('order_updated', {
            display_id,
            is_paid,
            is_completed,
            is_delivered: 1 // ✅ 핵심
        });

        res.json({ success: true });
    } catch (error) { /* 에러처리 */ } finally { conn.release(); }
});

// let connectedUsers = 0;
let currentCashierId = null; // 👑 현재 캐셔의 소켓 ID (없으면 null)

const connectedUsers = new Map();

io.on('connection', (socket) => {
    console.log(`🔌 연결됨: ${socket.id}`);

    // ✅ [신규] 유저가 로그인 후 "저 왔어요(아이디)"라고 신고하는 기능
    socket.on('register_user', (data) => {
        // data = { username: 'hong', role: 'staff' }
        connectedUsers.set(socket.id, data);
        broadcastUserCount();
    });

    // 2. "저 캐셔 할래요!" 요청 처리
    socket.on('claim_cashier', () => {
        if (currentCashierId === null) {
            currentCashierId = socket.id; // 자리 찜
            io.emit('cashier_status', true); // "야, 캐셔 자리 찼다" 방송
            socket.emit('cashier_claimed', true); // 당사자에게 "성공" 알림
            console.log(`👑 캐셔 등극: ${socket.id}`);
        } else {
            socket.emit('cashier_claimed', false); // "이미 누가 있어"
        }
    });

    socket.on('release_cashier', () => {
        // 요청한 사람이 현재 캐셔가 맞는지 확인
        if (socket.id === currentCashierId) {
            currentCashierId = null;          // 자리 비움
            io.emit('cashier_status', false); // "야, 캐셔 자리 비었다!" 방송
            console.log(`👋 캐셔 퇴근: ${socket.id}`);
        }
    });

    socket.on('logout', () => {
        console.log(`🚪 로그아웃 요청: ${socket.id}`);
        connectedUsers.delete(socket.id); // 명단에서 제거
        broadcastUserCount();             // 인원수 다시 계산해서 방송
    });

    // 3. 접속 끊김 처리
    socket.on('disconnect', () => {
        // 나간 사람 명부에서 지우기
        connectedUsers.delete(socket.id);
        broadcastUserCount();

        // ... (기존 캐셔 반납 로직 그대로 유지) ...
        if (socket.id === currentCashierId) {
            currentCashierId = null;
            io.emit('cashier_status', false);
        }
    });

    function broadcastUserCount() {
        const users = Array.from(connectedUsers.values());

        // 1. 관리자가 아닌 사람('staff' 등)만 골라냅니다.
        const staffUsers = users.filter(user => user.role !== 'admin');

        // 2. 그 중에서 중복된 아이디 제거 (유니크한 직원 수)
        const uniqueStaffCount = new Set(staffUsers.map(u => u.username)).size;

        console.log(`📊 매장 근무자 수: ${uniqueStaffCount}명 (관리자 제외됨)`);
        io.emit('user_count', uniqueStaffCount);
    }
});

app.patch('/api/orders/:display_id/complete', async (req, res) => {
    const { display_id } = req.params;
    const { paymentMethod } = req.body;

    const conn = await pool.getConnection();
    try {
        // 1. 해당 주문번호를 가진 모든 메뉴의 상태를 '완료(1)'로 변경
        await conn.query(
            `UPDATE orders SET is_paid = 1, is_completed = 1, payment_method = ? WHERE display_id = ?`,
            [paymentMethod || 'cash', display_id]
        );

        // 2. 변경된 상태를 모든 화면(주방, 카운터 등)에 알림
        io.emit('order_updated', { display_id, is_paid: 1, is_completed: 1 });

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false });
    } finally {
        conn.release();
    }
});

// [분리 모드 전용] 입금만 확인 처리 (제조는 아직 안 함)
app.patch('/api/orders/:display_id/pay', async (req, res) => {
    const { display_id } = req.params;
    const { paymentMethod } = req.body;

    const conn = await pool.getConnection();
    try {
        // 1. 입금 처리
        await conn.query(`UPDATE orders SET is_paid = 1, payment_method = ? WHERE display_id = ?`, [paymentMethod || 'cash', display_id]);

        // 2. 현재 조리 상태 조회
        const [rows] = await conn.query(`SELECT is_completed FROM orders WHERE display_id = ? LIMIT 1`, [display_id]);
        const isCompleted = rows[0]?.is_completed || 0;

        // 3. 알림 전송 (✅ 수정됨: 0 대신 isCompleted 변수 사용)
        io.emit('order_updated', { display_id, is_paid: 1, is_completed: isCompleted });

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false });
    } finally {
        conn.release();
    }
});

// [주문 삭제 API] 특정 주문번호(display_id)를 가진 내역을 DB에서 아예 지움
app.delete('/api/orders/:display_id', async (req, res) => {
    const { display_id } = req.params;
    const conn = await pool.getConnection();
    try {
        // 1. DB에서 삭제
        await conn.query('DELETE FROM orders WHERE display_id = ?', [display_id]);

        // 2. 모든 화면에 "야, 이거 삭제됐어!"라고 알림
        io.emit('order_deleted', display_id);

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false });
    } finally {
        conn.release();
    }
});

app.patch('/api/orders/:display_id/complete_kitchen', async (req, res) => {
    const { display_id } = req.params;
    const conn = await pool.getConnection();
    try {
        // 1. is_completed만 1로 변경 (is_paid는 그대로 둠)
        await conn.query(
            `UPDATE orders SET is_completed = 1 WHERE display_id = ?`,
            [display_id]
        );

        // 2. 변경 사실 알림
        // (주의: 여기서 is_paid 값을 DB에서 조회해서 같이 보내주면 더 완벽하지만,
        //  일단 화면에서 '완료'되면 목록에서 지워버리기 때문에 is_completed: 1만 보내도 충분합니다.)
        io.emit('order_updated', { display_id, is_completed: 1 });

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false });
    } finally {
        conn.release();
    }
});

app.get('/api/admin/sales', async (req, res) => {
    try {
        const conn = await pool.getConnection();
        // 최신순(내림차순) 정렬
        const [rows] = await conn.query(`
            SELECT * FROM orders 
            WHERE is_paid = 1 
            ORDER BY created_at DESC
        `);
        conn.release();
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// 2. 매출 내역 삭제 (환불/오류 수정용)
app.delete('/api/admin/sales/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const conn = await pool.getConnection();
        await conn.query('DELETE FROM orders WHERE id = ?', [id]);
        conn.release();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.get('/api/admin/settlements', async (req, res) => {
    try {
        const conn = await pool.getConnection();
        const [rows] = await conn.query(`
            SELECT * FROM cash_settlements 
            ORDER BY date DESC
        `);
        conn.release();
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// 1. 🔍 오늘 시재 상태 조회 (출근했는지, 마감했는지 확인)
app.get('/api/settlement/status', async (req, res) => {
    try {
        const conn = await pool.getConnection();

        // 1) 오늘 날짜 기록 확인
        const [todayRows] = await conn.query('SELECT * FROM cash_settlements WHERE date = CURDATE()');

        if (todayRows.length === 0) {
            // 2) 오늘 기록이 없으면? => '가장 최근의 마감된 기록'을 DB에서 찾습니다.
            const [prevRows] = await conn.query(`
                SELECT closing_amount
                FROM cash_settlements
                WHERE is_closed = 1
                ORDER BY date DESC, id DESC
                LIMIT 1
            `);

            // 전날 기록이 있으면 그 금액을, 없으면 0원을 가져옵니다.
            // 데이터베이스에서 가져온 값은 확실하게 Number()로 숫자로 바꿉니다.
            const prevClosing = prevRows.length > 0 ? Number(prevRows[0].closing_amount) : 0;

            conn.release();

            // ✅ status는 'not_opened'지만, prevClosing에는 '숫자(금액)'을 담아 보냅니다.
            res.json({ status: 'not_opened', prevClosing: prevClosing });
        } else {
            conn.release();
            res.json({ status: todayRows[0].is_closed ? 'closed' : 'opened', data: todayRows[0] });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// 2. ☀️ 오픈(출근) 처리: 시재금 입력
app.post('/api/settlement/open', async (req, res) => {
    const { amount } = req.body; // 사용자가 입력한 시작 금액 (예: 50,000원)
    try {
        const conn = await pool.getConnection();
        // 오늘 날짜로 시재금 기록 생성
        await conn.query('INSERT INTO cash_settlements (date, opening_amount) VALUES (CURDATE(), ?)', [amount]);
        conn.release();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// 3. 🌙 마감(퇴근) 전 계산: (오픈 금액 + 오늘 현금 매출) 계산해서 알려줌
app.get('/api/settlement/calc', async (req, res) => {
    try {
        const conn = await pool.getConnection();

        // 1) 아침에 입력한 시재금 가져오기
        const [settlement] = await conn.query('SELECT opening_amount FROM cash_settlements WHERE date = CURDATE()');
        if (settlement.length === 0) return res.status(400).json({ message: "아직 오픈하지 않았습니다." });

        const opening = settlement[0].opening_amount;

        // 2) 오늘 발생한 '현금(cash)' 매출 합계 계산
        const [orders] = await conn.query(`
            SELECT IFNULL(SUM(total_price), 0) as cash_sales 
            FROM orders 
            WHERE is_paid = 1 
            AND payment_method = 'cash' 
            AND DATE(created_at) = CURDATE()
        `);
        const cashSales = parseInt(orders[0].cash_sales);

        conn.release();

        // 3) 결과 리턴 (오픈금액, 현금매출, 있어야 할 총액)
        res.json({
            opening: opening,
            sales: cashSales,
            expected: opening + cashSales
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// 4. 🔒 마감(퇴근) 확정 처리
app.post('/api/settlement/close', async (req, res) => {
    const { closingAmount, salesCash, diff } = req.body;
    try {
        const conn = await pool.getConnection();
        await conn.query(`
            UPDATE cash_settlements 
            SET closing_amount = ?, sales_cash = ?, difference = ?, is_closed = 1 
            WHERE date = CURDATE()
        `, [closingAmount, salesCash, diff]);
        conn.release();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.get('/api/admin/stats', async (req, res) => {
    try {
        const conn = await pool.getConnection();

        // 1. 🍔 품목별 판매량 (많이 팔린 순)
        const [itemRows] = await conn.query(`
            SELECT menu_name, SUM(quantity) as total_qty, SUM(total_price) as total_sales
            FROM orders
            WHERE is_paid = 1
            GROUP BY menu_name
            ORDER BY total_sales DESC
        `);

        // 2. ⏰ 시간대별 판매량 (0시 ~ 23시)
        const [timeRows] = await conn.query(`
            SELECT HOUR(created_at) as hour, COUNT(*) as order_count, SUM(total_price) as total_sales
            FROM orders
            WHERE is_paid = 1
            GROUP BY HOUR(created_at)
            ORDER BY hour ASC
        `);

        conn.release();

        res.json({
            itemStats: itemRows,
            timeStats: timeRows
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

const rpID = process.env.NODE_ENV === 'production'
    ? FRONTEND_URL // ⚠️ 본인 Render 주소 (https:// 제외)
    : 'localhost';

const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
const origin = `${protocol}://${rpID}${process.env.NODE_ENV === 'production' ? '' : ':5173'}`;

const currentChallenges = {};

// 1. [기기 등록] 옵션 생성
app.get('/api/passkey/register-options', async (req, res) => {
    const { userId } = req.query;

    // ✅ [핵심] 현재 접속한 도메인(hostname)을 자동으로 가져옵니다.
    // (Localhost든 Render든 상관없이 무조건 현재 주소를 씁니다)
    // const rpID = req.hostname;

    const conn = await pool.getConnection();
    const [users] = await conn.query('SELECT * FROM users WHERE id = ?', [userId]);
    const [userPasskeys] = await conn.query('SELECT id FROM passkeys WHERE user_id = ?', [userId]);
    conn.release();

    if (users.length === 0) return res.status(400).json({ error: 'User not found' });
    const user = users[0];

    try {
        const options = await generateRegistrationOptions({
            rpName: 'Cafe POS',
            rpID: RP_ID, // 자동 감지된 주소 사용
            userID: new Uint8Array(Buffer.from(String(user.id))),
            userName: user.username,
            excludeCredentials: userPasskeys.map(key => ({
                id: key.id,
                transports: key.transports ? key.transports.split(',') : [],
            })),
            authenticatorSelection: {
                residentKey: 'preferred',
                userVerification: 'preferred',
                authenticatorAttachment: 'platform',
            },
        });

        // 챌린지 저장
        currentChallenges[userId] = options.challenge;
        res.json(options);
    } catch (err) {
        console.error("옵션 생성 실패:", err);
        res.status(500).json({ error: err.message });
    }
});

// 2. [기기 등록] 검증 및 저장
app.post('/api/passkey/register-verify', async (req, res) => {
    const { userId, body } = req.body;
    const expectedChallenge = currentChallenges[userId];
    // const rpID = req.hostname; // ✅ 자동 감지

    if (!expectedChallenge) return res.status(400).json({ error: 'Challenge not found' });

    try {
        const verification = await verifyRegistrationResponse({
            response: body,
            expectedChallenge,
            expectedOrigin: EXPECTED_ORIGIN, // 클라이언트가 보낸 Origin 그대로 사용
            expectedRPID: RP_ID,                // 자동 감지된 RP ID 사용
        });

        const { verified, registrationInfo } = verification;

        if (verified && registrationInfo) {
            const { credential } = registrationInfo;
            const { id, publicKey, counter } = credential;

            const pubKeyBase64 = Buffer.from(publicKey).toString('base64');
            const credentialIDString = String(id);

            const conn = await pool.getConnection();
            await conn.query(
                `INSERT INTO passkeys (id, public_key, counter, user_id, transports) VALUES (?, ?, ?, ?, ?)`,
                [credentialIDString, pubKeyBase64, counter, userId, 'internal']
            );
            conn.release();

            delete currentChallenges[userId];
            res.json({ success: true });
        } else {
            res.status(400).json({ success: false, message: 'Verification failed' });
        }
    } catch (error) {
        console.error("🚨 패스키 등록 에러:", error);
        return res.status(500).json({ error: error.message });
    }
});

// 3. [로그인] 옵션 생성
app.get('/api/passkey/login-options', async (req, res) => {
    // const rpID = req.hostname; // ✅ 자동 감지

    const options = await generateAuthenticationOptions({
        rpID: RP_ID,
        userVerification: 'preferred',
    });

    currentChallenges[options.challenge] = options.challenge;
    res.json(options);
});

// 4. [로그인] 검증
app.post('/api/passkey/login-verify', async (req, res) => {
    const { body } = req.body;
    // const rpID = req.hostname; // ✅ 자동 감지

    const conn = await pool.getConnection();
    const [rows] = await conn.query('SELECT * FROM passkeys WHERE id = ?', [body.id]);

    if (rows.length === 0) {
        conn.release();
        return res.status(400).json({ error: 'Passkey not found' });
    }

    const passkey = rows[0];
    const [users] = await conn.query('SELECT * FROM users WHERE id = ?', [passkey.user_id]);
    conn.release();

    const user = users[0];
    const pubKeyBuffer = Buffer.from(passkey.public_key, 'base64');

    try {
        const verification = await verifyAuthenticationResponse({
            response: body,
            expectedChallenge: (c) => true,
            expectedOrigin: EXPECTED_ORIGIN,
            expectedRPID: RP_ID, // ✅ 자동 감지된 주소로 검증
            credential: {
                id: passkey.id,
                publicKey: new Uint8Array(pubKeyBuffer),
                counter: Number(passkey.counter),
                transports: passkey.transports ? passkey.transports.split(',') : [],
            },
            requireUserVerification: false,
        });

        const { verified, authenticationInfo } = verification;

        if (verified) {
            const conn2 = await pool.getConnection();
            await conn2.query('UPDATE passkeys SET counter = ? WHERE id = ?', [authenticationInfo.newCounter, passkey.id]);
            conn2.release();

            const token = jwt.sign(
                { id: user.id, username: user.username, role: user.role, name: user.name },
                JWT_SECRET,
                { expiresIn: '12h' }
            );

            res.json({
                success: true,
                token,
                role: user.role,
                name: user.name,
                username: user.username,
                id: user.id
            });
        } else {
            res.status(400).json({ success: false, message: 'Verification failed' });
        }
    } catch (error) {
        console.error("🚨 패스키 로그인 에러:", error);
        return res.status(400).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`🚀 서버 실행 중: http://localhost:${PORT}`);
});

setInterval(() => {
    if (process.env.NODE_ENV === 'production') {
        // ⚠️ 본인 Render 주소로 꼭 수정하세요!
        const myUrl = 'https://cafe-server-0qur.onrender.com';
        https.get(myUrl, (res) => {
            console.log(`⏰ 셀프 알람: 서버 깨우기 성공 (Status: ${res.statusCode})`);
        }).on('error', (err) => {
            console.error('⏰ 셀프 알람 실패:', err.message);
        });
    }
}, 600000); // 10분