-- 재고 현황 조사.
--
-- 지금은 카카오톡에 손으로 적어 올린다. 그 방식의 문제는 두 가지다.
--  (1) '1봉-50개' 같은 환산 정보를 매번 다시 적는다. 품목마다 고정된 값인데 사람이 나른다.
--  (2) 기록이 채팅에 흩어져, 지난주보다 얼마나 줄었는지 보려면 스크롤을 거슬러 올라가야 한다.
--
-- ── 원가·순익 분석과 엮지 않는다 ──
-- 처음에는 ingredients(원가용 원재료)를 품목 목록으로 같이 쓰려 했다. '원두'가 두 곳에
-- 따로 있으면 언젠가 어긋난다는 이유였다. 그런데 두 매장 모두 원가 분석을 사실상 쓰지 않고,
-- 특히 매입가는 같은 규격이어도 살 때마다 달라져 유지 자체가 부담이라는 피드백을 받았다.
-- 매일 쓰는 기능이 안 쓰는 기능의 데이터 상태에 묶이면 안 된다. 그래서 테이블을 따로 둔다.
-- 대신 포기하는 것: 재고 금액(2.3봉지 = 23,000원어치)과, 판매량 대비 로스 분석.
-- 둘 다 원가·레시피가 정확해야 의미가 있는데 그 전제가 성립하지 않는다.
--
-- ── 세는 방법이 세 가지다 ──
--  pack   봉·줄·통 단위. 정수부는 안 뜯은 개수, 소수부는 뜯어 쓰는 것의 남은 비율이다.
--         '0.8봉'은 창고에 여분이 없고 뜯은 것이 80% 남았다는 뜻이고, '10.5봉'은 10봉이
--         그대로 있고 뜯은 것이 절반 남았다는 뜻이다. 매장이 원래 쓰던 표기 그대로다.
--         이 둘은 사정이 전혀 다르므로 화면에서는 정수부·소수부를 쪼개어 보여준다.
--  each   냉장고 안의 개수. 캔·우유처럼 낱개로 센다.
--  weight 저울로 잰다. 통을 올린 채 재므로 통 무게(tare_g)를 빼야 실제 내용물이 나온다.
--         저울은 '지금 쓰고 있는 통' 하나만 잰다. 창고의 안 뜯은 여분은 저울에 올리지 않으므로
--         spare_count(미개봉 몇 통)를 따로 받는다. 이게 없으면 개봉한 통이 바닥일 때
--         창고에 여분이 쌓여 있어도 '주문 필요'가 떠서 헛주문을 하게 된다.
--         남은 양 = (총중량 - 통 무게) + 미개봉 개수 × 한 통 용량.
--
-- count_per_pack은 '한 팩이 base_unit으로 얼마인가'다. 비워둘 수 있다 —
-- 빨대처럼 같은 '한 봉'인데도 들어 있는 개수가 100개일 때도 200개일 때도 있는 물건이 있다.
-- 그런 품목에 억지로 환산값을 넣으면 '0.8봉 (400개)'처럼 자신 있게 틀린 숫자가 나온다.
-- 비워두면 봉 수만 보여준다. 없는 편이 거짓말보다 낫다.
--   원두: base_unit='g', count_unit='봉지', count_per_pack=500 → 2.3봉지 = 1150g
--   페트컵: base_unit='개', count_unit='봉', count_per_pack=50 → 13봉 = 650개
--   콜라: base_unit='개', count_unit='개', count_per_pack=1    → 28개
-- 이 한 줄 덕분에 직원은 숫자만 넣고, 환산은 앱이 한다.
-- weight 품목의 count_per_pack은 '한 통 가득 채웠을 때 내용물이 몇 g인가'를 뜻한다.
--
-- 입고는 따로 기록하지 않는다. 물건이 들어오면 다음 조사에 그대로 반영된다 —
-- 조사 결과가 곧 현재 재고이고, 그게 지금 매장이 하는 방식이다.

CREATE TABLE IF NOT EXISTS inventory_items
(
    id             INT AUTO_INCREMENT PRIMARY KEY,
    name           VARCHAR(100)   NOT NULL,
    measure_mode   VARCHAR(10)    NOT NULL DEFAULT 'pack', -- pack | each | weight
    count_unit     VARCHAR(10)    NOT NULL DEFAULT '개',    -- 직원이 세는 단위: 봉지·줄·통·개·g
    count_per_pack DECIMAL(10, 2) NULL,                    -- 한 팩 = base_unit 기준 몇인가. NULL이면 환산하지 않는다
    base_unit      VARCHAR(10)    NOT NULL DEFAULT '개',    -- 환산해서 보여줄 단위: 개 | g | ml
    tare_g         DECIMAL(10, 2) NULL,                    -- weight 전용. 통 무게
    low_threshold  DECIMAL(10, 2) NULL,                    -- 이 값 이하면 '주문 필요'. NULL이면 판단 안 함
    is_active      TINYINT(1)     NOT NULL DEFAULT 1,      -- 뺀 품목은 0 (지난 기록은 그대로 남는다)
    sort_order     INT            NOT NULL DEFAULT 0,      -- 조사 화면 표시 순서
    updated_at     TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 세는 단위 이름 목록.
--
-- 자유 입력으로 두면 한 사람이 '봉지'라 적고 다른 사람이 '봉'이라 적어 같은 물건이 두 이름으로
-- 갈린다. 관리자가 쓸 이름을 미리 정해두고 품목은 그중에서 고르게 한다.
--
-- 이름만 모아둔다. '1줄 = 몇 개'는 여기 두지 않는다 — 같은 '줄'이라도 컵홀더 기본은 80개,
-- 병역은 20개, 1L는 100개로 품목마다 다르다. 개수까지 묶으면 오히려 안 맞는다.
--
-- 기본값에 같은 뜻인 이름을 둘 다 넣지 않는다. 실제 보고서에서 '빨대 0.8봉지 (1봉-500개)'처럼
-- 한 줄 안에서도 봉/봉지가 섞여 있었다. 둘 다 고를 수 있게 두면 목록을 만든 의미가 없다.
CREATE TABLE IF NOT EXISTS inventory_units
(
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(10) NOT NULL,
    sort_order INT         NOT NULL DEFAULT 0,
    UNIQUE KEY uq_inventory_units_name (name)
);

-- 조사 한 회차. 하루 여러 번(시각은 매장마다 다름 — 019 참고)이라 (날짜, 회차)에 UNIQUE를 건다.
-- 위생 점검의 (check_date, slot)과 같은 구조다 — 같은 회차를 두 번 내면 새 기록이 아니라 수정이다.
CREATE TABLE IF NOT EXISTS inventory_counts
(
    id              INT AUTO_INCREMENT PRIMARY KEY,
    count_date      DATE         NOT NULL,
    slot            VARCHAR(10)  NOT NULL,                                        -- '11' | '15' | '17'
    counted_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,              -- 실제 제출 시각
    counted_by_id   VARCHAR(36)  NULL,                                            -- users.id. FK를 걸지 않는다(계정을 지워도 기록은 남는다)
    counted_by_name VARCHAR(50)  NOT NULL,                                        -- 이름 스냅샷
    memo            VARCHAR(500) NULL,                                            -- 특이사항
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_inventory_counts_date_slot (count_date, slot)
);

-- 회차별 품목 수치.
--
-- 문구·단위·환산값을 그대로 복사해 둔다. 관리자가 나중에 품목을 고쳐도 지난 기록은 그날 본
-- 그대로여야 한다. 위생 점검이 item_label을 복사해 두는 것과 같은 이유다.
-- low_threshold까지 복사하는 이유: 그날 '주문 필요'로 봤는지가 기준을 바꾼 뒤에도 재현돼야 한다.
-- 반대로 tare_g는 복사해도 비어 있을 수 있다(통을 비워야 잴 수 있어서). 그 경우 조회할 때
-- 품목의 현재 값으로 메운다 — 통 무게는 정책이 아니라 물건의 물리적 성질이라, 나중에 알게
-- 됐을 뿐 그 전에도 같은 값이었다.
CREATE TABLE IF NOT EXISTS inventory_count_items
(
    id             INT AUTO_INCREMENT PRIMARY KEY,
    count_id       INT            NOT NULL,
    item_id        INT            NULL,                  -- 품목이 지워져도 기록은 남는다
    item_label     VARCHAR(100)   NOT NULL,              -- 품목명 스냅샷
    measure_mode   VARCHAR(10)    NOT NULL,
    count_unit     VARCHAR(10)    NOT NULL,
    count_per_pack DECIMAL(10, 2) NULL,
    base_unit      VARCHAR(10)    NOT NULL,
    tare_g         DECIMAL(10, 2) NULL,
    low_threshold  DECIMAL(10, 2) NULL,
    quantity       DECIMAL(10, 2) NOT NULL,              -- 직원이 적은 숫자(weight면 통 포함 총중량)
    spare_count    DECIMAL(10, 2) NOT NULL DEFAULT 0,    -- weight 전용. 창고의 미개봉 여분 통 수
    sort_order     INT            NOT NULL DEFAULT 0,
    CONSTRAINT fk_inventory_item_count FOREIGN KEY (count_id) REFERENCES inventory_counts (id) ON DELETE CASCADE,
    CONSTRAINT fk_inventory_item_ref FOREIGN KEY (item_id) REFERENCES inventory_items (id) ON DELETE SET NULL,
    KEY idx_inventory_items_count (count_id)
);
