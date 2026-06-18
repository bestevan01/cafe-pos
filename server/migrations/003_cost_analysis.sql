-- 원가·순익 분석 기능용 스키마.
--  (1) ingredients   : 원재료. 구매 단위 용량/가격 → 단위당 원가 산출
--  (2) menu_recipes  : 메뉴 한 잔에 들어가는 원재료와 사용량(BOM)
--  (3) menu.cost_override : 혼합 모델의 '수동 원가 덮어쓰기'. NULL이면 레시피 자동계산 사용.
--
-- 서버 시작 시 server.js의 ensureSchema()가 IF NOT EXISTS / 중복컬럼 무시로 자동 적용하지만,
-- 앱 DB 유저에게 CREATE/ALTER 권한이 없으면 이 SQL을 한 번 수동 실행한다.

CREATE TABLE IF NOT EXISTS ingredients
(
    id              INT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(100)   NOT NULL,             -- 원재료명 (예: 원두, 복숭아 파우더, 1L컵)
    purchase_price  INT            NOT NULL,             -- 구매 가격(원)
    purchase_amount DECIMAL(10, 2) NOT NULL,             -- 구매 용량/수량 (예: 1000)
    unit            VARCHAR(10)    NOT NULL DEFAULT 'g', -- 단위: g | ml | ea
    updated_at      TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- menu.id는 varchar(36) UUID이므로 menu_id도 동일 타입/collation으로 맞춰야 FK가 걸린다.
CREATE TABLE IF NOT EXISTS menu_recipes
(
    id            INT AUTO_INCREMENT PRIMARY KEY,
    menu_id       VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
    ingredient_id INT                             NOT NULL,
    amount        DECIMAL(10, 2)                  NOT NULL, -- 이 메뉴 한 잔에 쓰는 양 (원재료 unit 기준)
    UNIQUE KEY uq_menu_ingredient (menu_id, ingredient_id),
    CONSTRAINT fk_recipe_menu FOREIGN KEY (menu_id) REFERENCES menu (id) ON DELETE CASCADE,
    CONSTRAINT fk_recipe_ingredient FOREIGN KEY (ingredient_id) REFERENCES ingredients (id) ON DELETE CASCADE
);

-- 혼합 모델: 수동 원가(있으면 우선). NULL이면 레시피 자동계산을 사용.
-- (이미 컬럼이 있으면 ALTER가 실패하므로, 처음 한 번만 실행)
ALTER TABLE menu
    ADD COLUMN cost_override INT NULL DEFAULT NULL;
