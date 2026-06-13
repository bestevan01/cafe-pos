-- 주문번호(daily_number) 동시성 안전을 위한 카운터 테이블.
-- order.routes.js 의 POST /api/orders 가 이 테이블을 원자적으로 증가시켜
-- 동시에 들어온 주문들도 같은 번호를 받지 않도록 보장한다.
--
-- 서버 시작 시 자동으로 CREATE TABLE IF NOT EXISTS 가 실행되지만,
-- 앱 DB 유저에게 CREATE 권한이 없는 경우 이 SQL을 한 번 수동 실행해야 한다.

CREATE TABLE IF NOT EXISTS daily_order_counters
(
    order_date  DATE NOT NULL PRIMARY KEY,
    last_number INT  NOT NULL DEFAULT 0
);
