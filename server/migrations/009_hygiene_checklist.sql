-- 위생 점검 체크리스트 기능용 스키마.
--  (1) hygiene_items         : 관리자가 편집하는 '현재 체크리스트' 템플릿
--  (2) hygiene_checks        : 점검 1건(하루 1건). 누가 언제 했는지
--  (3) hygiene_check_results : 그 점검의 항목별 결과
--
-- 서버 시작 시 server.js의 ensureSchema()가 IF NOT EXISTS로 자동 적용한다.
-- DB가 매장마다 따로 있어(본부동·은혜관·테스트) 수동 실행은 빠뜨리기 쉬우므로 자동 적용에 맡긴다.
--
-- ⚠️ 설계상 가장 중요한 점: 결과 행에 item_label / item_category를 '복사해서' 저장한다.
--    관리자가 항목 문구를 고치거나 항목을 지워도 과거 기록은 그날 점검한 문구 그대로 남아야 한다.
--    (위생 기록은 감사 목적이라 소급 변경되면 안 된다)
--    item_id는 참조용으로만 남기고, 항목이 삭제되면 NULL이 된다.
--
-- ⚠️ 정수 표시 너비(int(11), tinyint(1) 등)는 쓰지 않는다.
--    TiDB가 deprecation 경고(1681)를 낸다.

CREATE TABLE IF NOT EXISTS hygiene_items
(
    id         INT AUTO_INCREMENT PRIMARY KEY,
    label      VARCHAR(200) NOT NULL,                -- 점검 문구 (예: 냉장고 온도 5℃ 이하 확인)
    category   VARCHAR(50)  NOT NULL DEFAULT '공통', -- 묶음 (예: 개인위생 / 조리도구 / 냉장·냉동)
    sort_order INT          NOT NULL DEFAULT 0,      -- 같은 분류 안에서의 표시 순서
    is_active  TINYINT      NOT NULL DEFAULT 1,      -- 0 = 은퇴. 삭제 대신 끄면 과거 기록의 item_id가 살아남는다
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_hygiene_items_active (is_active, sort_order, id)
);

CREATE TABLE IF NOT EXISTS hygiene_checks
(
    id              INT AUTO_INCREMENT PRIMARY KEY,
    check_date      DATE         NOT NULL,           -- 점검일. 하루 1건이라 UNIQUE
    checked_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 제출 시각(오전 중 완료 여부 판단에 쓴다)
    checked_by_id   VARCHAR(36)  NULL,               -- users.id. FK를 걸지 않는다(계정을 지워도 기록은 남아야 한다)
    checked_by_name VARCHAR(50)  NOT NULL,           -- 점검자 이름 스냅샷. orders.staff_name과 같은 방식
    memo            VARCHAR(500) NULL,               -- 전체 특이사항
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_hygiene_checks_date (check_date)
);

CREATE TABLE IF NOT EXISTS hygiene_check_results
(
    id            INT AUTO_INCREMENT PRIMARY KEY,
    check_id      INT          NOT NULL,
    item_id       INT          NULL,                 -- 참조용. 항목이 삭제되면 NULL
    item_label    VARCHAR(200) NOT NULL,             -- 제출 시점 스냅샷 (위 주석 참고)
    item_category VARCHAR(50)  NOT NULL,             -- 제출 시점 스냅샷
    sort_order    INT          NOT NULL DEFAULT 0,   -- 제출 시점 순서. 보고서를 그날 모습대로 재현한다
    status        VARCHAR(10)  NOT NULL,             -- ok | fail | na
    note          VARCHAR(500) NULL,                 -- status='fail'이면 필수(앱 레벨 검증)
    CONSTRAINT fk_hygiene_result_check FOREIGN KEY (check_id) REFERENCES hygiene_checks (id) ON DELETE CASCADE,
    CONSTRAINT fk_hygiene_result_item FOREIGN KEY (item_id) REFERENCES hygiene_items (id) ON DELETE SET NULL,
    KEY idx_hygiene_results_check (check_id)
);
