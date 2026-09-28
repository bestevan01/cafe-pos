-- 저울 품목의 용기 이름(통·봉지 등)을 품목마다 정한다. (서버 기동 때 server.js가 자동으로 적용한다 — 이 파일은 기록용)
--
-- 저울 품목은 '미개봉 ○개 + 쓰고 있는 용기를 저울에 올린 무게'로 센다. 처음엔 베이스·딸기청(통)만 있어
-- 화면이 전부 '통'이라고 불렀는데, 원두처럼 봉지인 품목도 같은 방식으로 센다. '미개봉 4통',
-- '빈 통 무게'로 보이면 원두를 저울 품목으로 넣어야 한다는 걸 떠올리기 어렵다.
--  - 기존 품목은 '통'으로 둔다(지금까지 보이던 것과 같다).
--  - 조사 기록에도 그때 이름을 복사해 둔다. 비어 있는 옛 기록은 품목의 현재 이름(없으면 '통')으로 보여준다.

ALTER TABLE inventory_items
    ADD COLUMN container_unit VARCHAR(10) NOT NULL DEFAULT '통' AFTER base_unit;

ALTER TABLE inventory_count_items
    ADD COLUMN container_unit VARCHAR(10) NULL AFTER base_unit;
