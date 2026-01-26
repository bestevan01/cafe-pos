const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mysql = require('mysql2/promise'); // mysql2 도구 불러오기

const app = express();

app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"] }));
app.use(express.json()); // 프론트에서 보내는 JSON 데이터를 읽을 수 있게 설정

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

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
        rejectUnauthorized: true
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
    const { items, force } = req.body;

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
            const sql = `INSERT INTO orders (menu_name, quantity, total_price, daily_number, display_id) VALUES (?, ?, ?, ?, ?)`;
            // 개별 가격 계산이 필요하다면 여기서 처리, 일단은 전체 가격을 1/N 하거나 0으로 넣고 별도 관리하지만
            // 여기선 간단히 개별 항목에는 0원을 넣거나, 프론트에서 개별 가격을 보내주는 게 좋습니다.
            // (편의상 total_price는 첫 번째 행에만 넣거나 나누어 넣을 수 있지만, 여기선 item마다 가격을 받는 구조로 가정합니다)
            await conn.query(sql, [item.menu_name, item.quantity, item.price, nextDailyNum, formattedID]);
        }

        await conn.commit(); // DB 반영

        // 4. 소켓 전송 (프론트엔드에게 보낼 데이터 정제)
        // 묶음 주문 정보를 보냅니다.
        const newOrderGroup = {
            display_id: formattedID,
            daily_number: seqNum,
            items: items, // 주문한 메뉴 리스트
            created_at: new Date(),
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

let connectedUsers = 0;
let currentCashierId = null; // 👑 현재 캐셔의 소켓 ID (없으면 null)

io.on('connection', (socket) => {
    connectedUsers++;
    console.log(`User connected. Total: ${connectedUsers}`);

    // 1. 접속자 수와 현재 캐셔가 있는지 여부를 전송
    io.emit('user_count', connectedUsers);
    io.emit('cashier_status', currentCashierId !== null); // 캐셔 자리 찼니? (true/false)

    socket.on('request_state', () => {
        socket.emit('user_count', connectedUsers);
        socket.emit('cashier_status', currentCashierId !== null);
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

    // 3. 접속 끊김 처리
    socket.on('disconnect', () => {
        connectedUsers--;
        console.log(`User disconnected. Total: ${connectedUsers}`);

        // 만약 나간 사람이 캐셔였다면?
        if (socket.id === currentCashierId) {
            currentCashierId = null; // 자리 비움
            io.emit('cashier_status', false); // "캐셔 자리 비었다!" 방송
            console.log(`👑 캐셔 퇴장. 공석입니다.`);
        }

        io.emit('user_count', connectedUsers);
    });
});

app.patch('/api/orders/:display_id/complete', async (req, res) => {
    const { display_id } = req.params;

    const conn = await pool.getConnection();
    try {
        // 1. 해당 주문번호를 가진 모든 메뉴의 상태를 '완료(1)'로 변경
        await conn.query(
            `UPDATE orders SET is_paid = 1, is_completed = 1 WHERE display_id = ?`,
            [display_id]
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
    const conn = await pool.getConnection();
    try {
        // 1. 입금 처리
        await conn.query(`UPDATE orders SET is_paid = 1 WHERE display_id = ?`, [display_id]);

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

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`🚀 서버 실행 중: http://localhost:${PORT}`);
});