-- 위생 점검 회차를 매장이 직접 정한다. (서버 기동 때 server.js가 자동으로 적용한다 — 이 파일은 기록용)
--
-- 운영 지침이 매장별 점검 시각을 정했다(예: 한 매장은 9시·16시, 다른 매장은 오픈·마감).
-- 오전·오후를 정오로 나누는 고정 두 칸으로는 매장마다 다른 시각도, 시각 알림도 담을 수 없다.
-- 재고 조사 회차와 같은 공통 모듈(utils/slotSchedule.js)을 쓴다. 코드는 매장끼리 공유하므로
-- 기본 회차는 넣지 않는다. 비어 있는 동안에는 예전처럼 오전(am)·오후(pm)를 정오로 나눈다.
--
-- ── 소급하지 않는다 ──
-- 1) 기록에 회차 이름을 복사한다(slot_label). 회차를 지우거나 바꿔도 지난 기록은 그날 이름 그대로다.
--    이름을 복사하기 전의 기록은 오전·오후 두 칸뿐이었으므로 그 이름으로 채운다.
-- 2) 회차를 바꿀 때마다 '그날부터의 회차 목록'을 hygiene_slot_plans에 남긴다. 보고서는 날짜마다
--    그날 유효했던 목록으로 '해야 했던 회차'를 그린다. 지금 설정으로 과거를 그리면 회차를 바꾼 순간
--    지난 기록이 전부 '기록 없음'투성이가 된다. 이력이 없는 날은 예전 오전·오후 두 칸으로 본다.
--
-- 매장별 문구(점검 안내 등)를 코드에 박지 않도록 키-값 표(store_settings)도 함께 둔다.

CREATE TABLE IF NOT EXISTS hygiene_slots
(
    id         INT AUTO_INCREMENT PRIMARY KEY,
    slot_key   VARCHAR(10) NOT NULL,              -- 'HHMM'. 문자열 정렬이 곧 시간 순. 예전 기록의 'am'/'pm'과 겹치지 않는다
    label      VARCHAR(20) NOT NULL,              -- 화면에 보일 이름. 예: '오픈'
    run_at     TIME        NOT NULL,              -- 점검 예정 시각
    sort_order INT         NOT NULL DEFAULT 0,
    UNIQUE KEY uq_hygiene_slots_key (slot_key)
);

CREATE TABLE IF NOT EXISTS hygiene_slot_plans
(
    effective_date DATE PRIMARY KEY,              -- 이날부터 유효. 같은 날 여러 번 바꾸면 마지막 것만 남는다
    slots          TEXT      NOT NULL,            -- JSON [{slot_key, label}]
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS store_settings
(
    setting_key     VARCHAR(64) PRIMARY KEY,      -- 예: 'hygiene_guide'
    setting_value   TEXT        NOT NULL,
    updated_by_name VARCHAR(50) NULL,
    updated_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

ALTER TABLE hygiene_checks
    ADD COLUMN slot_label VARCHAR(20) NULL AFTER slot;

-- 비어 있는 것만 채운다(부팅마다 돌아도 이미 적힌 이름을 건드리지 않는다).
UPDATE hygiene_checks
SET slot_label = IF(slot = 'pm', '오후', '오전')
WHERE slot_label IS NULL
  AND slot IN ('am', 'pm');
