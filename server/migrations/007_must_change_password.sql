-- 관리자가 임시 비밀번호를 발급한 계정을 표시한다.
-- 이 값이 1이면 로그인 직후 비밀번호 변경 화면이 강제로 뜨고,
-- 본인이 새 비밀번호를 저장하면 0으로 내려간다.
--
-- 서버 시작 시 자동으로 ALTER가 실행되지만,
-- 앱 DB 유저에게 ALTER 권한이 없는 경우 이 SQL을 한 번 수동 실행해야 한다.

ALTER TABLE users
    ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0;
