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
const inventoryRoutes = require('./routes/inventory.routes');
const inventoryAdminRoutes = require('./routes/inventoryAdmin.routes');
const alertRoutes = require('./routes/alerts.routes');
const pushRoutes = require('./routes/push.routes');
const myAlertsRoutes = require('./routes/myAlerts.routes');
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
/**
 * 스키마 준비가 끝나야 요청을 받는다. 이 약속이 지켜질 때까지 listen하지 않는다.
 *
 * 예전에는 연결 확인과 listen이 서로를 기다리지 않아, 스키마를 고치는 배포마다 몇 초짜리
 * 창이 생겼다. 실제로 위생 점검을 하루 2회로 바꾸던 배포에서 'Your service is live'가
 * 유니크 키 교체보다 먼저 찍혔다. 그 사이에 들어온 요청은 옛 제약에 걸린다.
 *
 * 실패해도 listen은 한다. DB가 잠깐 안 붙는다고 배포가 통째로 멈추면 더 나쁘다 —
 * TiDB Serverless는 잠들었다 깨느라 늦을 때가 있고, 그때 옛 인스턴스가 계속 살아 있는
 * 것보다 새 인스턴스가 떠서 오류를 알려주는 편이 낫다. 대신 크게 로그를 남긴다.
 */
const SCHEMA_READY_TIMEOUT_MS = 60000;

const schemaReady = pool
    .getConnection()
    .then(async (/** @type {any} */ conn) => {
        console.log('✅ [DB] 데이터베이스 연결 성공!');
        conn.release();
        await ensureSchema();
    })
    .catch((/** @type {any} */ err) => {
        console.error('❌ [DB] 데이터베이스 연결 실패:', err);
    });

/** 스키마 준비를 기다리되, 무한정 붙들려 배포가 멈추지는 않게 한다. */
function waitForSchema() {
    /** @type {any} */
    let timer;
    const giveUp = new Promise((resolve) => {
        timer = setTimeout(() => {
            console.error(
                `🔥 [DB] 스키마 준비가 ${SCHEMA_READY_TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다. ` +
                    '그대로 요청을 받기 시작합니다 — 스키마가 옛 상태일 수 있습니다.',
            );
            resolve(undefined);
        }, SCHEMA_READY_TIMEOUT_MS);
        timer.unref(); // 이 타이머 하나 때문에 프로세스가 안 죽는 일이 없도록
    });
    // race에서 진 쪽은 저절로 멈추지 않는다. 타이머를 지우지 않으면 스키마가 제때 끝나도
    // 60초 뒤에 위 경고가 그대로 찍혀, 정작 진짜 문제일 때 구분할 수 없게 된다.
    return Promise.race([schemaReady, giveUp]).finally(() => clearTimeout(timer));
}

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

    // menu.sort_order 컬럼 보장 (관리자가 정한 표시 순서, 이미 있으면 무시)
    // 자세한 설계 의도는 migrations/011_menu_sort_order.sql 참고.
    try {
        await pool.query('ALTER TABLE menu ADD COLUMN sort_order INT NOT NULL DEFAULT 0');
    } catch (/** @type {any} */ err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            console.error('⚠️ [DB] menu.sort_order 컬럼 추가 실패 (수동 마이그레이션 필요):', err.message);
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

    // 위생 점검 체크리스트. 자세한 설계 의도는 migrations/009_hygiene_checklist.sql 참고.
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
        console.error('⚠️ [DB] 위생 점검 테이블 생성 실패 (수동 마이그레이션 필요):', err.message);
    }

    // 위생 점검 기록의 수정 이력. 자세한 배경은 migrations/013_hygiene_check_edits.sql 참고.
    // 수정은 결과를 통째로 지우고 다시 쓰므로, 남기지 않으면 누가 무엇을 고쳤는지 알 수 없다.
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hygiene_check_edits
            (
                id             INT AUTO_INCREMENT PRIMARY KEY,
                check_id       INT         NOT NULL,
                edited_by_id   VARCHAR(36) NULL,
                edited_by_name VARCHAR(50) NOT NULL,
                edited_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                changes        TEXT        NOT NULL,
                CONSTRAINT fk_hygiene_edit_check FOREIGN KEY (check_id) REFERENCES hygiene_checks (id) ON DELETE CASCADE,
                KEY idx_hygiene_edits_check (check_id, edited_at)
            )
        `);
    } catch (/** @type {any} */ err) {
        console.error('⚠️ [DB] hygiene_check_edits 테이블 생성 실패 (수동 마이그레이션 필요):', err.message);
    }

    // 웹 푸시 구독. 자세한 배경은 migrations/018_push_subscriptions.sql 참고.
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS push_subscriptions
            (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                endpoint   VARCHAR(500) NOT NULL,
                p256dh     VARCHAR(255) NOT NULL,
                auth_key   VARCHAR(255) NOT NULL,
                -- users.id와 같은 collation이어야 조인된다. 자세한 배경은 migrations/018 주석 참고.
                user_id    VARCHAR(36) COLLATE utf8mb4_general_ci NULL,
                user_agent VARCHAR(255) NULL,
                created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_sent  DATETIME     NULL,
                UNIQUE KEY uq_push_endpoint (endpoint(255)),
                KEY idx_push_user (user_id)
            )
        `);
    } catch (/** @type {any} */ err) {
        console.error('⚠️ [DB] push_subscriptions 생성 실패:', err.message);
    }

    // 정해진 시각에 브라우저 알림을 띄우는 공통 장치. 자세한 배경은 migrations/017_alert_schedules.sql 참고.
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS alert_schedules
            (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                alert_key       VARCHAR(50) NOT NULL,
                run_at          TIME        NOT NULL,
                is_enabled      TINYINT(1)  NOT NULL DEFAULT 1,
                last_fired_date DATE        NULL,
                created_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_alert_key_time (alert_key, run_at),
                KEY idx_alert_enabled (is_enabled, run_at)
            )
        `);
    } catch (/** @type {any} */ err) {
        console.error('⚠️ [DB] alert_schedules 생성 실패:', err.message);
    }

    // 재고 현황 조사. 자세한 배경은 migrations/016_inventory_counts.sql 참고.
    // 원가·순익 분석(ingredients)과 엮지 않는다 — 두 매장 모두 안 쓰는 기능이라,
    // 매일 쓰는 재고가 그 데이터 상태에 묶이면 안 된다.
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS inventory_items
            (
                id             INT AUTO_INCREMENT PRIMARY KEY,
                name           VARCHAR(100)   NOT NULL,
                measure_mode   VARCHAR(10)    NOT NULL DEFAULT 'pack',
                count_unit     VARCHAR(10)    NOT NULL DEFAULT '개',
                count_per_pack DECIMAL(10, 2) NULL,
                base_unit      VARCHAR(10)    NOT NULL DEFAULT '개',
                tare_g         DECIMAL(10, 2) NULL,
                low_threshold  DECIMAL(10, 2) NULL,
                is_active      TINYINT(1)     NOT NULL DEFAULT 1,
                sort_order     INT            NOT NULL DEFAULT 0,
                updated_at     TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS inventory_units
            (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                name       VARCHAR(10) NOT NULL,
                sort_order INT         NOT NULL DEFAULT 0,
                UNIQUE KEY uq_inventory_units_name (name)
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS inventory_counts
            (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                count_date      DATE         NOT NULL,
                slot            VARCHAR(10)  NOT NULL,
                slot_label      VARCHAR(20)  NULL,
                counted_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                counted_by_id   VARCHAR(36)  NULL,
                counted_by_name VARCHAR(50)  NOT NULL,
                memo            VARCHAR(500) NULL,
                updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_inventory_counts_date_slot (count_date, slot)
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS inventory_count_items
            (
                id             INT AUTO_INCREMENT PRIMARY KEY,
                count_id       INT            NOT NULL,
                item_id        INT            NULL,
                item_label     VARCHAR(100)   NOT NULL,
                measure_mode   VARCHAR(10)    NOT NULL,
                count_unit     VARCHAR(10)    NOT NULL,
                count_per_pack DECIMAL(10, 2) NULL,
                base_unit      VARCHAR(10)    NOT NULL,
                tare_g         DECIMAL(10, 2) NULL,
                low_threshold  DECIMAL(10, 2) NULL,
                quantity       DECIMAL(10, 2) NOT NULL,
                spare_count    DECIMAL(10, 2) NOT NULL DEFAULT 0,
                sort_order     INT            NOT NULL DEFAULT 0,
                CONSTRAINT fk_inventory_item_count FOREIGN KEY (count_id) REFERENCES inventory_counts (id) ON DELETE CASCADE,
                CONSTRAINT fk_inventory_item_ref FOREIGN KEY (item_id) REFERENCES inventory_items (id) ON DELETE SET NULL,
                KEY idx_inventory_items_count (count_id)
            )
        `);
        // 조사 회차. 매장마다 다르므로 표로 둔다. 자세한 배경은 migrations/019_inventory_slots.sql 참고.
        await pool.query(`
            CREATE TABLE IF NOT EXISTS inventory_slots
            (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                slot_key   VARCHAR(10) NOT NULL,
                label      VARCHAR(20) NOT NULL,
                run_at     TIME        NOT NULL,
                sort_order INT         NOT NULL DEFAULT 0,
                UNIQUE KEY uq_inventory_slots_key (slot_key)
            )
        `);
        // 회차는 기본값을 깔지 않는다. 코드는 매장끼리 공유하는데 조사 시각은 매장마다 달라서,
        // 어느 한 매장 시각을 넣어 두면 다른 매장에는 틀린 값이 조용히 들어간다.
        // 비어 있는 동안에는 하루 한 번('조사')으로 기록된다(utils/inventorySlots.js FALLBACK).
        // 품목도 비어서 시작하므로, 관리자가 품목을 넣을 때 회차도 함께 정하면 된다.

        // 처음 한 번만 흔한 단위를 넣어준다. 비어 있는 화면에서 시작하면 뭘 적어야 할지 막막하다.
        const [[u]] = await pool.query('SELECT COUNT(*) AS n FROM inventory_units');
        if (u.n === 0) {
            await pool.query('INSERT INTO inventory_units (name, sort_order) VALUES ?', [
                // 같은 뜻인 이름을 둘 다 넣지 않는다. '봉'과 '봉지'를 나란히 두면
                // 사람마다 다른 쪽을 골라 같은 물건이 두 이름으로 갈린다 —
                // 단위 목록을 만든 이유가 그걸 막기 위해서다. 필요하면 관리자가 추가하면 된다.
                [
                    ['줄', 1],
                    ['봉', 2],
                    ['통', 3],
                    ['개', 4],
                    ['박스', 5],
                    ['g', 6],
                ],
            ]);
            console.log('✅ [DB] 재고 단위 기본값 6개 생성');
        }
    } catch (/** @type {any} */ err) {
        console.error('⚠️ [DB] 재고 조사 테이블 생성 실패 (수동 마이그레이션 필요):', err.message);
    }

    // 회차 이름 스냅샷. 관리자가 시각을 바꿔도 지난 기록은 그날 부르던 이름 그대로여야 한다.
    try {
        await pool.query('ALTER TABLE inventory_counts ADD COLUMN slot_label VARCHAR(20) NULL');
    } catch (/** @type {any} */ err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            console.error('⚠️ [DB] inventory_counts.slot_label 추가 실패:', err.message);
        }
    }

    // 주방의 항목별 중간 체크. 자세한 배경은 migrations/015_order_item_made.sql 참고.
    try {
        await pool.query('ALTER TABLE orders ADD COLUMN is_made TINYINT(1) NOT NULL DEFAULT 0');
        console.log('✅ [DB] 주문 항목별 조리 체크 컬럼 추가');
    } catch (/** @type {any} */ err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            console.error('⚠️ [DB] orders.is_made 컬럼 추가 실패:', err.message);
        }
    }

    // 제출된 점검의 사진은 지워도 실제로 지우지 않는다. 자세한 배경은 migrations/014_hygiene_photo_soft_delete.sql 참고.
    try {
        await pool.query(`ALTER TABLE hygiene_check_photos
            ADD COLUMN removed_at      DATETIME    NULL,
            ADD COLUMN removed_by_id   VARCHAR(36) NULL,
            ADD COLUMN removed_by_name VARCHAR(50) NULL`);
        console.log('✅ [DB] 위생 점검 사진 삭제 기록 컬럼 추가');
    } catch (/** @type {any} */ err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            console.error('⚠️ [DB] hygiene_check_photos 삭제 기록 컬럼 추가 실패:', err.message);
        }
    }

    // 위생 점검을 하루 2회(오전·오후)로 나눈다. 자세한 배경은 migrations/012_hygiene_check_slot.sql 참고.
    // 컬럼 추가와 달리 인덱스를 갈아끼우는 작업이라 단계를 나누고 각각 결과를 확인한다.
    try {
        await pool.query("ALTER TABLE hygiene_checks ADD COLUMN slot VARCHAR(10) NOT NULL DEFAULT 'am'");
        // 컬럼을 방금 만들었을 때만 실제 제출 시각으로 칸을 바로잡는다.
        // 전부 아침일 거라 여겼지만 16:29, 13:22처럼 오후에 낸 기록도 있어, 그대로 두면
        // 보고서에 '오전 · 16:29'처럼 앞뒤가 안 맞는 줄이 남는다.
        // 부팅마다 돌리면 안 된다 — 아침 점검을 늦게 낸 경우처럼 사람이 일부러 고른 칸을 덮어쓴다.
        // 경계는 정오. routes/hygiene.routes.js의 PM_FROM_HOUR와 같아야 한다 —
        // 다르면 과거 기록과 앞으로 쌓일 기록의 기준이 달라진다.
        const [fixed] = await pool.query("UPDATE hygiene_checks SET slot = 'pm' WHERE HOUR(checked_at) >= 12");
        console.log(`✅ [DB] 위생 점검 칸 컬럼 추가 — 오후 제출 ${fixed.affectedRows}건을 pm으로 보정`);
    } catch (/** @type {any} */ err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            console.error('⚠️ [DB] hygiene_checks.slot 컬럼 추가 실패:', err.message);
        }
    }
    try {
        // 새 키를 먼저 만든다. 옛 키를 먼저 지웠다가 이게 실패하면 중복 방지가 사라진다.
        await pool.query('ALTER TABLE hygiene_checks ADD UNIQUE KEY uq_hygiene_checks_date_slot (check_date, slot)');
    } catch (/** @type {any} */ err) {
        if (err.code !== 'ER_DUP_KEYNAME') {
            console.error('⚠️ [DB] hygiene_checks 복합 유니크 키 추가 실패:', err.message);
        }
    }
    try {
        // 옛 키가 남아 있으면 날짜당 1건 제약이 유지되어 오후 점검이 막힌다. 반드시 지워야 한다.
        await pool.query('ALTER TABLE hygiene_checks DROP INDEX uq_hygiene_checks_date');
        console.log('✅ [DB] 위생 점검 하루 1건 제약 해제 (오전·오후 2회 가능)');
    } catch (/** @type {any} */ err) {
        // 이미 지워진 경우가 정상 경로다. 그 외 사유는 오후 점검이 막히므로 크게 알린다.
        if (err.code !== 'ER_CANT_DROP_FIELD_OR_KEY') {
            console.error('🔥 [DB] 옛 유니크 키 제거 실패 — 오후 점검이 막힙니다:', err.message);
        }
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
app.use('/api/inventory', inventoryRoutes);
app.use('/api/admin/inventory', inventoryAdminRoutes);
app.use('/api/admin/alerts', alertRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/alerts/mine', myAlertsRoutes);

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
// [7-1] 정해진 시각 알림 (Scheduled alerts)
// ---------------------------------------------------------
// 알림 장치는 공통이고(utils/alerts.js), 기능이 '무엇을 알릴지'를 등록한다.
// 다른 기능도 여기에 한 줄씩 더하면 된다.
const { registerAlert, startAlertScheduler } = require('./utils/alerts');
const { loadSlots, currentSlot, syncInventoryReminders } = require('./utils/inventorySlots');
const { latestStatus, lowAlertText } = require('./services/inventoryStatus');

registerAlert('inventory_low', {
    label: '재고 주문 필요',
    description: '주문 기준을 넘긴 품목이 있으면 알려드립니다. 누르면 재고 현황 화면이 열립니다.',
    audience: 'admin',
    // 누르면 관리자 재고 현황 화면으로 간다.
    action: 'open_inventory_status',
    build: async () => {
        const status = await latestStatus();
        // 기록이 없거나 부족한 품목이 없으면 굳이 알리지 않는다.
        // '이상 없음' 알림이 매일 뜨면 사람은 곧 무시하게 된다.
        if (!status.count || status.low.length === 0) return null;
        return lowAlertText(status);
    },
});

// 재고 조사 시각 알림 — 지금 접속해 있는 근무자에게 '조사할 시간'이라고 알린다.
// 시각은 따로 입력받지 않고 재고 조사 회차를 그대로 따라간다(managed). 두 곳에 입력하게 하면
// 언젠가 어긋난다. 회차가 바뀌면 inventoryAdmin.routes.js가 syncInventoryReminders()를 부른다.
registerAlert('inventory_count_reminder', {
    label: '재고 조사 시각 알림',
    description: '조사할 시간이 되면 알려드립니다. 누르면 재고 조사 화면이 바로 열립니다.',
    audience: 'staff',
    // 소켓으로만 보낸다. 푸시는 탭을 닫은 사람의 개인 폰까지 울리므로, 쉬는 날 근무자에게
    // '재고 조사하세요'가 가게 된다. 지금 접속해 일하고 있는 사람에게만 가면 된다.
    channels: ['socket'],
    // 늦게 가면 쓸모가 없다. 30분이 지나면 다음 회차가 가까워 오히려 헷갈린다.
    graceMinutes: 30,
    managed: true,
    // 누르면 재고 조사 화면이 바로 열린다.
    action: 'open_inventory_count',
    build: async ({ runAt }) => {
        // 스케줄러는 예정 시각을 넘겨준다. '지금 보내보기'처럼 시각 없이 불리면 지금 회차로 본다.
        let slot;
        if (runAt) {
            slot = (await loadSlots()).find((s) => s.run_at === runAt);
            if (!slot) return null; // 그사이 회차가 바뀌었다
        } else {
            const now = await currentSlot();
            slot = now.slots.find((s) => s.slot_key === now.key);
            if (!slot) return null;
        }
        // 이미 누가 냈으면 알리지 않는다. 할 일이 없는데 울리면 알림을 무시하는 버릇만 생긴다.
        const [[done]] = await pool.query(
            'SELECT counted_by_name FROM inventory_counts WHERE count_date = CURDATE() AND slot = ? LIMIT 1',
            [slot.slot_key],
        );
        if (done) return null;
        return {
            title: `${slot.label} 재고 조사 시간입니다`,
            body: '눌러서 바로 기록할 수 있습니다.',
        };
    },
});

startAlertScheduler(io);
// 기동 때 한 번 맞춘다. 회차는 있는데 알림 시각이 비어 있는 상태(처음 배포 등)를 메운다.
void syncInventoryReminders().catch((/** @type {any} */ err) =>
    console.error('⚠️ [알림] 재고 조사 시각 동기화 실패:', err.message),
);

// ---------------------------------------------------------
// [8] 서버 실행 (Listen)
// ---------------------------------------------------------
waitForSchema().then(() => {
    server.listen(PORT, () => {
        const serverUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
        const env = IS_PRODUCTION ? '☁️ 운영(Production)' : '💻 개발(Local)';

        console.log(`=================================`);
        console.log(`🚀 [서버 실행됨] ${env}`);
        console.log(`🔗 주소: ${serverUrl}`);
        console.log(`=================================`);
    });
});
