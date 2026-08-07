-- 원재료 분류(category) 추가: 식재료 / 부자재(컵·빨대·뚜껑 등 포장재).
-- 원가 계산은 분류와 무관하게 동일하지만, 목록·레시피를 그룹으로 나눠 관리하기 위함.
--
-- server.js의 ensureSchema()가 중복컬럼 무시로 자동 적용한다.
-- 권한이 없으면 이 SQL을 한 번 수동 실행.

ALTER TABLE ingredients
    ADD COLUMN category VARCHAR(10) NOT NULL DEFAULT '식재료';
