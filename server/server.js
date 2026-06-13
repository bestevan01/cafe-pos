// ---------------------------------------------------------
// [1] 환경 설정 및 모듈 가져오기 (Imports)
// ---------------------------------------------------------
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config({path: '../.env'});
}

const express = require('express');
const http = require('http');
const {Server} = require('socket.io');
const cors = require('cors');
const morgan = require('morgan');

const pool = require('./config/db'); // 데이터베이스 설정

// 라우터 모듈 가져오기
const authRoutes = require('./routes/auth.routes');
const menuRoutes = require('./routes/menu.routes');
const orderRoutes = require('./routes/order.routes');
const eventRoutes = require('./routes/event.routes');
const salesRoutes = require('./routes/sales.routes');
const settlementRoutes = require('./routes/settlement.routes');
const statsRoutes = require('./routes/stats.routes');
const passkeyRoutes = require('./routes/passkey.routes');
const healthRoutes = require('./routes/health.routes');

const errorHandler = require('./middlewares/errorHandler');

const setupSocketHandlers = require('./sockets/socketHandlers')

// ---------------------------------------------------------
// [2] 환경 변수 및 상수 설정 (Constants)
// ---------------------------------------------------------
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = 'bu-cafe-pos.vercel.app';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error("🚨 FATAL: JWT_SECRET is missing.");
    process.exit(1);
}

const CORS_ORIGIN = IS_PRODUCTION ? `https://${FRONTEND_URL}` : "http://localhost:5173";

// ---------------------------------------------------------
// [3] Express App 및 Socket.IO 초기화 (Init)
// ---------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {origin: CORS_ORIGIN, methods: ["GET", "POST"]}
});

// ---------------------------------------------------------
// [4] 데이터베이스 연결 확인 (DB Connection)
// ---------------------------------------------------------
pool.getConnection()
    .then(conn => {
        console.log("✅ [DB] 데이터베이스 연결 성공!");
        conn.release();
    })
    .catch(err => {
        console.error("❌ [DB] 데이터베이스 연결 실패:", err);
    });

// ---------------------------------------------------------
// [5] 미들웨어 설정 (Middlewares)
// ---------------------------------------------------------
app.set('io', io); // 라우터에서 사용할 수 있도록 io 객체 전역 저장

app.use(cors({
    origin: CORS_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"]
}));
app.use(express.json());
app.use(morgan('dev'));

// ---------------------------------------------------------
// [6] API 라우트 등록 (Routes)
// ---------------------------------------------------------
// 일반 API
app.use('/api', authRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/events', eventRoutes);
app.use('/api', passkeyRoutes);

// 관리자, 정산 및 통계 API
app.use('/api/admin/sales', salesRoutes);
app.use('/api/admin/stats', statsRoutes);
app.use('/api/settlements', settlementRoutes);

// 상태 확인용 API (Health Check)
app.use('/ping', healthRoutes);

// 전역 에러 처리 미들웨어
app.use(errorHandler);

// ---------------------------------------------------------
// [7] Socket.IO 이벤트 관리 (WebSockets)
// ---------------------------------------------------------
setupSocketHandlers(io);

// ---------------------------------------------------------
// [8] 서버 실행 (Listen)
// ---------------------------------------------------------
server.listen(PORT, () => {
    const serverUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    const env = IS_PRODUCTION ? '☁️ 운영(Production)' : '💻 개발(Local)';

    console.log(`=================================`);
    console.log(`🚀 [서버 실행됨] ${env}`);
    console.log(`🔗 주소: ${serverUrl}`);
    console.log(`=================================`);
});