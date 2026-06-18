CREATE DATABASE IF NOT EXISTS cafe_db;

USE cafe_db;

CREATE TABLE `orders`
(
    `id`               VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    `daily_number`     int(11)     NOT NULL    DEFAULT 1,
    `display_id`       varchar(20)             DEFAULT NULL,
    `menu_name`        varchar(50) NOT NULL,
    `quantity`         int(11)     NOT NULL    DEFAULT 1,
    `total_price`      int(11)     NOT NULL    DEFAULT 0,
    `payment_method`   varchar(20) NOT NULL    DEFAULT 'cash', -- ✅ 핵심: cash 또는 bank 저장
    `is_paid`          tinyint(1)  NOT NULL    DEFAULT 0,
    `is_completed`     tinyint(1)  NOT NULL    DEFAULT 0,
    `is_delivered`     tinyint(1)              DEFAULT 0,
    `staff_name`       VARCHAR(50)             DEFAULT '키오스크',
    `applied_event_id` VARCHAR(36)             DEFAULT NULL,
    `created_at`       datetime                DEFAULT current_timestamp()
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci;

CREATE TABLE users
(
    id         VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    username   VARCHAR(50)  NOT NULL UNIQUE,              -- 아이디
    password   VARCHAR(255) NOT NULL,                     -- 암호화된 비밀번호
    name       VARCHAR(50)  NOT NULL,                     -- 이름 (예: 홍길동)
    role       VARCHAR(20)             DEFAULT 'pending', -- roles: 'admin'(관리자), 'staff'(직원), 'pending'(승인대기)
    created_at TIMESTAMP               DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE passkeys
(
    id          VARCHAR(255) NOT NULL,  -- 자격 증명 ID (Credential ID)
    public_key  TEXT         NOT NULL,  -- 공개키
    counter     INT          DEFAULT 0, -- 위변조 방지 카운터
    user_id     VARCHAR(36)  NOT NULL,  -- 누구의 패스키인지 (users 테이블 FK)
    device_type VARCHAR(32)  DEFAULT 'singleDevice',
    device_name VARCHAR(255) DEFAULT '알 수 없는 기기',
    backed_up   TINYINT(1)   DEFAULT 0,
    transports  VARCHAR(255) DEFAULT '',
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- 2. 메뉴 테이블 (이제 파일 대신 DB에서 메뉴를 불러옵니다)
CREATE TABLE menu
(
    id         VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    name       VARCHAR(100) NOT NULL,
    price      INT          NOT NULL,
    type       VARCHAR(20)  NOT NULL,                -- 'coffee', 'tea' 등
    is_soldout BOOLEAN                 DEFAULT FALSE -- 품절 여부
);

CREATE TABLE cash_settlements
(
    id             VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    date           DATE NOT NULL,                         -- 영업일 (2026-01-27)
    opening_amount INT                     DEFAULT 0,     -- 오픈 시재 (출근할 때 금고에 있던 돈)
    closing_amount INT                     DEFAULT 0,     -- 마감 시재 (퇴근할 때 실제 세어본 돈)
    sales_cash     INT                     DEFAULT 0,     -- 그날의 순수 현금 매출 (시스템 계산)
    difference     INT                     DEFAULT 0,     -- 차액 (마감 - (오픈 + 매출)) => 0이어야 정상
    is_closed      BOOLEAN                 DEFAULT FALSE, -- 마감 완료 여부
    created_at     TIMESTAMP               DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE events
(
    id              VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    name            VARCHAR(255) NOT NULL,
    type            VARCHAR(50)  NOT NULL,                 -- 'free' 또는 'discount'
    discount_amount INT                     DEFAULT 0,
    daily_limit     INT                     DEFAULT NULL,  -- 제한이 없으면 NULL
    target_menus    VARCHAR(1000)           DEFAULT 'all', -- 적용 대상 메뉴 (JSON 배열 텍스트 또는 'all')
    is_active       TINYINT(1)              DEFAULT 0,     -- 0: OFF, 1: ON
    used_count      INT                     DEFAULT 0,
    last_used_date  DATE                    DEFAULT NULL,
    created_at      TIMESTAMP               DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO menu (name, price, type)
VALUES ('뜨거운 아메리카노', 1500, 'coffee'),
       ('아이스 아메리카노', 2000, 'coffee'),
       ('복숭아 아이스티', 2000, 'tea'),
       ('아샷추', 2500, 'coffee'),
       ('1L 아이스 아메리카노', 3500, 'coffee'),
       ('1L 복숭아 아이스티', 3500, 'tea'),
       ('1L 아샷추', 4000, 'coffee');

SELECT *
FROM orders
ORDER BY created_at DESC;

TRUNCATE TABLE users;
TRUNCATE TABLE passkeys;

UPDATE users
SET role = 'admin'
WHERE username = 'admin';

UPDATE users
SET role = 'staff'
WHERE username = 'admin';

CREATE INDEX idx_orders_created_at ON orders (created_at);

SET FOREIGN_KEY_CHECKS = 0;
SET FOREIGN_KEY_CHECKS = 1;