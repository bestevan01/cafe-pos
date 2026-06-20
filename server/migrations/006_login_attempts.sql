-- 로그인 무차별 대입(brute-force) 방어용 레이트리밋 카운터.
-- IP별 '실패 횟수 + 윈도우 만료시각'을 저장한다.
-- 인메모리 Map 대신 DB에 두어 서버 재시작·스케일아웃에도 카운터가 유지된다.
--
-- server.js의 ensureSchema()가 자동 생성한다. 권한이 없으면 이 SQL을 한 번 수동 실행.

CREATE TABLE IF NOT EXISTS login_attempts
(
    attempt_key VARCHAR(255) NOT NULL, -- 보통 클라이언트 IP
    failures    INT          NOT NULL DEFAULT 0,
    reset_at    DATETIME     NOT NULL, -- 이 시각이 지나면 카운터 리셋
    PRIMARY KEY (attempt_key),
    KEY idx_reset (reset_at)
);
