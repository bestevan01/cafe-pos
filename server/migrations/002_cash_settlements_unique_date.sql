-- 시재 중복 오픈을 DB 레벨에서 원천 차단하기 위한 UNIQUE 제약 (선택적 강화).
-- 앱 레벨 가드(settlement.routes.js POST /open)만으로도 일반 상황은 막히지만,
-- 동시 오픈 경쟁까지 완전히 차단하려면 이 제약을 적용한다.
--
-- ⚠️ 자동 실행하지 않는다. 기존 데이터에 같은 date가 여러 행이면 ALTER가 실패하므로
--    먼저 중복을 정리해야 한다.

-- 1) 중복 날짜 확인
-- SELECT date, COUNT(*) AS cnt FROM cash_settlements GROUP BY date HAVING cnt > 1;

-- 2) (중복이 있으면) 각 날짜에서 가장 마지막 행만 남기고 정리한 뒤 아래 제약 추가.
--    예시 정리 쿼리(환경에 맞게 검토 후 실행):
--    DELETE c1 FROM cash_settlements c1
--    JOIN cash_settlements c2
--      ON c1.date = c2.date AND c1.id < c2.id;

-- 3) UNIQUE 제약 추가
ALTER TABLE cash_settlements
    ADD CONSTRAINT uq_cash_settlements_date UNIQUE (date);
