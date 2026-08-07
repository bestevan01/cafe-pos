-- 단기·1회용 토큰 공용 저장소.
-- WebAuthn 챌린지를 비롯해 OTP / 비밀번호 재설정 / 멱등키 등 재사용 가능(purpose로 구분).
-- 메모리 전역 객체 대신 DB에 두어 서버 재시작·스케일아웃에도 생존시킨다.
--
-- server.js의 ensureSchema()가 자동 생성한다. 권한이 없으면 이 SQL을 한 번 수동 실행.

CREATE TABLE IF NOT EXISTS ephemeral_tokens
(
    token      VARCHAR(255) NOT NULL,
    purpose    VARCHAR(40)  NOT NULL, -- 'webauthn_login' | 'webauthn_register' | ...
    payload    TEXT         NULL,     -- 부가 데이터(예: 등록 challenge)
    expires_at DATETIME     NOT NULL,
    PRIMARY KEY (token),
    KEY idx_purpose_expires (purpose, expires_at)
);
