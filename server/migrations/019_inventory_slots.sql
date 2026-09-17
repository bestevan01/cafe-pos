-- 재고 조사 회차를 매장이 직접 정한다.
--
-- 처음에는 11시·15시·17시를 코드에 박아 뒀다. 본부동 기준이었는데, 은혜관은 근무 시간도
-- 오후 점검 시각도 달라서 같을 이유가 없다. 매장마다 DB가 분리돼 있으니 표로 빼면
-- 각자 자기 시각을 쓴다.
--
-- 기본 회차는 넣지 않는다. 코드는 매장끼리 공유하므로 어느 매장 시각을 넣든 다른 매장에는
-- 틀린 값이 된다. 비어 있는 동안에는 하루 한 번('조사')으로 기록되고, 관리자가 품목과 함께 정한다.
--
-- ── 관리자는 '시각'만 정하고, 경계는 앱이 만든다 ──
-- 11시와 15시 사이의 경계를 13시로 잡는 식으로, 이웃한 두 시각의 가운데를 자동으로 쓴다.
-- 경계를 직접 입력하게 하면 "11시 조사인데 왜 13시까지 11시 회차인가"를 매번 설명해야 한다.
-- 조사가 조금 늦어도 가운데를 넘지 않으면 원래 회차로 들어간다.
--
-- slot_key를 'HHMM'으로 두는 이유: 문자열 정렬이 곧 시간 순이라 FIELD(...) 같은 목록을
-- 코드에 들고 다니지 않아도 된다. 회차가 몇 개든 ORDER BY slot 하나로 끝난다.
--
-- inventory_counts.slot_label은 스냅샷이다. 관리자가 나중에 시각을 바꾸거나 회차를 지워도
-- 지난 기록은 그날 부르던 이름 그대로여야 한다(위생 점검이 항목 문구를 복사해 두는 것과 같다).

CREATE TABLE IF NOT EXISTS inventory_slots
(
    id         INT AUTO_INCREMENT PRIMARY KEY,
    slot_key   VARCHAR(10) NOT NULL,              -- 'HHMM'. 문자열 정렬이 곧 시간 순
    label      VARCHAR(20) NOT NULL,              -- 화면에 보일 이름. 예: '오전 11시'
    run_at     TIME        NOT NULL,              -- 조사 예정 시각
    sort_order INT         NOT NULL DEFAULT 0,
    UNIQUE KEY uq_inventory_slots_key (slot_key)
);

ALTER TABLE inventory_counts
    ADD COLUMN slot_label VARCHAR(20) NULL AFTER slot;
