// ---------------------------------------------------------
// [1] 환경 설정 및 모듈 가져오기 (Imports)
// ---------------------------------------------------------
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config({ path: require('path').join(__dirname, '.env') });
}

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
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
const hygieneRoutes = require('./routes/hygiene.routes');
const hygieneAdminRoutes = require('./routes/hygieneAdmin.routes');
const statsRoutes = require('./routes/stats.routes');
const costRoutes = require('./routes/cost.routes');
const passkeyRoutes = require('./routes/passkey.routes');
const healthRoutes = require('./routes/health.routes');

const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');

const setupSocketHandlers = require('./sockets/socketHandlers');

// ---------------------------------------------------------
// [2] 환경 변수 및 상수 설정 (Constants)
// ---------------------------------------------------------
const PORT = process.env.PORT || 3000;
// FRONTEND_URL 검증·파생은 config/frontend.js가 담당한다(폴백 없음, 누락 시 기동 중단).
const { FRONTEND_ORIGIN, IS_PRODUCTION } = require('./config/frontend');
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error('🚨 FATAL: JWT_SECRET is missing.');
    process.exit(1);
}

const CORS_ORIGIN = FRONTEND_ORIGIN;

// ---------------------------------------------------------
// [3] Express App 및 Socket.IO 초기화 (Init)
// ---------------------------------------------------------
const app = express();
app.set('trust proxy', 1); // Render 등 리버스 프록시 뒤에서 req.ip가 실제 클라이언트 IP가 되도록
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] },
});

// ---------------------------------------------------------
// [4] 데이터베이스 연결 확인 (DB Connection)
// ---------------------------------------------------------
pool.getConnection()
    .then(async (/** @type {any} */ conn) => {
        console.log('✅ [DB] 데이터베이스 연결 성공!');
        conn.release();
        await ensureSchema();
    })
    .catch((/** @type {any} */ err) => {
        console.error('❌ [DB] 데이터베이스 연결 실패:', err);
    });

// 주문번호 카운터 테이블 보장 (없으면 생성). 권한이 없으면 경고만 남기고 진행.
async function ensureSchema() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS daily_order_counters
            (
                order_date  DATE NOT NULL PRIMARY KEY,
                last_number INT  NOT NULL DEFAULT 0
            )
        `);
    } catch (/** @type {any} */ err) {
        console.error('⚠️ [DB] daily_order_counters 테이블 생성 실패 (수동 마이그레이션 필요):', err.message);
    }

    // 원가·순익 분석 테이블 (ingredients / menu_recipes). 참조 순서상 ingredients 먼저 생성.
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ingredients
            (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                name            VARCHAR(100)   NOT NULL,
                purchase_price  INT            NOT NULL,
                purchase_amount DECIMAL(10, 2) NOT NULL,
                unit            VARCHAR(10)    NOT NULL DEFAULT 'g',
                updated_at      TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS menu_recipes
            (
                id            INT AUTO_INCREMENT PRIMARY KEY,
                menu_id       VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
                ingredient_id INT                             NOT NULL,
                amount        DECIMAL(10, 2)                  NOT NULL,
                UNIQUE KEY uq_menu_ingredient (menu_id, ingredient_id),
                CONSTRAINT fk_recipe_menu FOREIGN KEY (menu_id) REFERENCES menu (id) ON DELETE CASCADE,
                CONSTRAINT fk_recipe_ingredient FOREIGN KEY (ingredient_id) REFERENCES ingredients (id) ON DELETE CASCADE
            )
        `);
    } catch (/** @type {any} */ err) {
        console.error('⚠️ [DB] 원가분석 테이블 생성 실패 (수동 마이그레이션 필요):', err.message);
    }

    // menu.cost_override 컬럼 보장 (이미 있으면 무시)
    try {
        await pool.query('ALTER TABLE menu ADD COLUMN cost_override INT NULL DEFAULT NULL');
    } catch (/** @type {any} */ err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            console.error('⚠️ [DB] menu.cost_override 컬럼 추가 실패 (수동 마이그레이션 필요):', err.message);
        }
    }

    // ingredients.category 컬럼 보장 (식재료/부자재 분류, 이미 있으면 무시)
    try {
        await pool.query("ALTER TABLE ingredients ADD COLUMN category VARCHAR(10) NOT NULL DEFAULT '식재료'");
    } catch (/** @type {any} */ err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            console.error('⚠️ [DB] ingredients.category 컬럼 추가 실패 (수동 마이그레이션 필요):', err.message);
        }
    }

    // users.must_change_password 컬럼 보장 (관리자 임시 비밀번호 발급 표시, 이미 있으면 무시)
    try {
        await pool.query('ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0');
    } catch (/** @type {any} */ err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            console.error('⚠️ [DB] users.must_change_password 컬럼 추가 실패 (수동 마이그레이션 필요):', err.message);
        }
    }

    // 단기·1회용 토큰 저장소 (WebAuthn 챌린지 등). 메모리 대신 DB로 재시작/스케일아웃 대비.
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ephemeral_tokens
            (
                token      VARCHAR(255) NOT NULL,
                purpose    VARCHAR(40)  NOT NULL,
                payload    TEXT         NULL,
                expires_at DATETIME     NOT NULL,
                PRIMARY KEY (token),
                KEY idx_purpose_expires (purpose, expires_at)
            )
        `);
    } catch (/** @type {any} */ err) {
        console.error('⚠️ [DB] ephemeral_tokens 테이블 생성 실패 (수동 마이그레이션 필요):', err.message);
    }

    // 로그인 레이트리밋 카운터 (brute-force 방어). 메모리 대신 DB로 재시작/스케일아웃 대비.
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS login_attempts
            (
                attempt_key VARCHAR(255) NOT NULL,
                failures    INT          NOT NULL DEFAULT 0,
                reset_at    DATETIME     NOT NULL,
                PRIMARY KEY (attempt_key),
                KEY idx_reset (reset_at)
            )
        `);
    } catch (/** @type {any} */ err) {
        console.error('⚠️ [DB] login_attempts 테이블 생성 실패 (수동 마이그레이션 필요):', err.message);
    }

    // 위생점검 체크리스트. 자세한 설계 의도는 migrations/009_hygiene_checklist.sql 참고.
    // 결과 행에 항목 문구를 복사해 두는 것이 핵심 — 관리자가 항목을 고쳐도 과거 기록이 바뀌면 안 된다.
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hygiene_items
            (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                label      VARCHAR(200) NOT NULL,
                category   VARCHAR(50)  NOT NULL DEFAULT '공통',
                sort_order INT          NOT NULL DEFAULT 0,
                is_active  TINYINT      NOT NULL DEFAULT 1,
                created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_hygiene_items_active (is_active, sort_order, id)
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hygiene_checks
            (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                check_date      DATE         NOT NULL,
                checked_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                checked_by_id   VARCHAR(36)  NULL,
                checked_by_name VARCHAR(50)  NOT NULL,
                memo            VARCHAR(500) NULL,
                updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_hygiene_checks_date (check_date)
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hygiene_check_results
            (
                id            INT AUTO_INCREMENT PRIMARY KEY,
                check_id      INT          NOT NULL,
                item_id       INT          NULL,
                item_label    VARCHAR(200) NOT NULL,
                item_category VARCHAR(50)  NOT NULL,
                sort_order    INT          NOT NULL DEFAULT 0,
                status        VARCHAR(10)  NOT NULL,
                note          VARCHAR(500) NULL,
                CONSTRAINT fk_hygiene_result_check FOREIGN KEY (check_id) REFERENCES hygiene_checks (id) ON DELETE CASCADE,
                CONSTRAINT fk_hygiene_result_item FOREIGN KEY (item_id) REFERENCES hygiene_items (id) ON DELETE SET NULL,
                KEY idx_hygiene_results_check (check_id)
            )
        `);
        // 사진 첨부. 파일은 R2에 있고 여기엔 위치와 메타데이터만 둔다.
        // 자세한 흐름은 migrations/010_hygiene_photos.sql 참고.
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hygiene_check_photos
            (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                check_id     INT          NULL,
                item_id      INT          NULL,
                r2_key       VARCHAR(255) NOT NULL,
                status       VARCHAR(10)  NOT NULL,
                bytes        INT          NULL,
                content_type VARCHAR(100) NULL,
                width        INT          NULL,
                height       INT          NULL,
                uploaded_by  VARCHAR(36)  NULL,
                created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_hygiene_photo_key (r2_key),
                KEY idx_hygiene_photos_check (check_id),
                CONSTRAINT fk_hygiene_photo_check FOREIGN KEY (check_id) REFERENCES hygiene_checks (id) ON DELETE CASCADE
            )
        `);
    } catch (/** @type {any} */ err) {
        console.error('⚠️ [DB] 위생점검 테이블 생성 실패 (수동 마이그레이션 필요):', err.message);
    }
}

// ---------------------------------------------------------
// [5] 미들웨어 설정 (Middlewares)
// ---------------------------------------------------------
app.set('io', io); // 라우터에서 사용할 수 있도록 io 객체 전역 저장

app.use(
    cors({
        origin: CORS_ORIGIN,
        credentials: true,
        methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    }),
);
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
app.use('/api/admin', costRoutes);
app.use('/api/settlements', settlementRoutes);
app.use('/api/hygiene', hygieneRoutes);
app.use('/api/admin/hygiene', hygieneAdminRoutes);

// 상태 확인용 API (Health Check)
app.use('/ping', healthRoutes);

// 매칭되는 라우트가 없을 때 (404)
app.use(notFound);

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
