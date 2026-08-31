-- orders 조회 성능용 인덱스.
--
-- ⚠️ 이 파일은 서버 기동 시 자동 실행되지 않는다. 새 매장 DB를 만들 때 직접 실행할 것.
--    (idx_orders_created_at이 000 파일 맨 끝 작업용 구문들 사이에 묻혀 있어
--     본부동·테스트 DB에서 누락됐던 전례가 있다. 2026-08-31 수동 보정)
--
-- display_id: 결제 확인·조리 완료·전달 완료·주문 취소가 모두 이 컬럼으로 행을 찾는다.
--             주문 처리 경로에서 가장 자주 불리는 조건이다.
-- is_delivered + created_at: 캐셔·주방 화면이 열릴 때마다 도는
--             'SELECT * FROM orders WHERE is_delivered = 0 ORDER BY created_at DESC'용.

ALTER TABLE orders
    ADD INDEX idx_orders_display_id (display_id),
    ADD INDEX idx_orders_undelivered (is_delivered, created_at);
