-- 재고 조사 임시 저장. (서버 기동 때 server.js가 자동으로 적용한다 — 이 파일은 기록용)
--
-- 조사 도중 손님이 오거나 자리를 비워야 할 때가 있다. 지금까지는 모든 칸을 채워야만 저장할 수 있어
-- 창을 닫으면 적은 숫자가 모두 사라졌다. 적은 만큼 남겨 두고 나중에(다른 기기·다른 사람이라도) 이어서 채운다.
--
-- ── 임시 저장은 기록이 아니다 ──
--  - 현재 재고, 조사 기록, 직전 회차 비교, '주문 필요' 알림 어디에도 잡히지 않는다.
--    칸이 비어 있는 조사로 판단하면 빈 칸이 '없음'처럼 보이거나, 반대로 부족한 품목을 놓친다.
--  - 조사 시각 알림은 그 회차를 '아직 안 함'으로 본다. 하다 만 조사가 알림으로 다시 떠올라야 마무리된다.
--  - 모든 칸을 채워 제출하면 그때 기록이 된다(is_draft = 0). 제출 시각과 제출한 사람도 그때로 적는다.
--
-- ── 값은 inventory_count_items가 아니라 draft_values(JSON 문자열)에 둔다 ──
-- inventory_count_items.quantity는 NOT NULL이고, 그 표를 읽는 곳(현재 재고·기록·비교)은 모두 완성된
-- 기록을 전제한다. 빈 칸을 그 표에 넣으면 읽는 곳마다 빈 값을 걸러야 하고, 하나라도 빠뜨리면
-- 0으로 읽혀 '다 떨어졌다'가 된다. 임시 값은 따로 두고, 제출하는 순간에만 그 표에 행을 만든다.
--   draft_values 예: {"3": {"quantity": 2.3, "spare": null, "over": false},
--                     "7": {"quantity": null, "spare": 2, "over": true}}
--
-- 임시 저장도 (날짜, 회차) 자리를 차지한다. 이어서 하는 사람은 새로 내지 않고 그 기록을 채운다.
-- 지난 날짜의 임시 저장은 이어서 할 수 없고, 어디에도 보이지 않는다.

ALTER TABLE inventory_counts
    ADD COLUMN is_draft TINYINT(1) NOT NULL DEFAULT 0 AFTER memo;

ALTER TABLE inventory_counts
    ADD COLUMN draft_values TEXT NULL AFTER is_draft;
