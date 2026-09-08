-- 위생 점검 사진 첨부용 스키마.
--
-- 사진 파일 자체는 Cloudflare R2에 있고, 이 테이블은 '어디에 무엇이 있는지'만 기록한다.
-- R2에 목록을 물어보지 않기 위해서다 — ListObjects는 Class A 작업이라 화면을 열 때마다
-- 호출하면 무료 한도를 갉아먹는다. 키를 DB에 두면 객체로 직접 접근할 수 있다.
--
-- 업로드 흐름 (브라우저가 R2로 직접 올린다. 파일이 Render를 거치지 않는다):
--   1) 서명 요청 → 서버가 키를 정하고 이 테이블에 status='pending'으로 행을 먼저 만든다
--   2) 브라우저가 서명 URL로 R2에 PUT
--   3) 확인 요청 → 서버가 HeadObject로 실제 크기·타입을 확인하고 status='ready'
--   4) 점검 제출 시 photo_id를 함께 보내면 check_id가 채워진다
--
-- 1)에서 행을 먼저 만드는 이유: 2)와 3) 사이에 브라우저가 죽으면 R2에만 파일이 남는데,
-- 행이 있으면 그것도 집계·정리 대상으로 잡힌다. 실제보다 많게 세는 쪽이라 안전하다.
--
-- 보관 기간은 R2 Object Lifecycle 규칙(730일)이 담당한다. 앱은 지우지 않고,
-- created_at이 2년을 넘으면 조회용 URL을 발급하지 않는 것으로 맞춘다.

CREATE TABLE IF NOT EXISTS hygiene_check_photos
(
    id           INT AUTO_INCREMENT PRIMARY KEY,
    check_id     INT          NULL,      -- 제출 전에는 NULL. 제출 시 채워진다
    item_id      INT          NULL,      -- 어느 점검 항목의 사진인지
    r2_key       VARCHAR(255) NOT NULL,  -- R2 객체 키
    status       VARCHAR(10)  NOT NULL,  -- pending | ready
    bytes        INT          NULL,      -- HeadObject로 확인한 실제 크기
    content_type VARCHAR(100) NULL,      -- 실제 타입(HEIC로 올라오는지 확인용)
    width        INT          NULL,      -- 클라이언트가 보고한 원본 해상도
    height       INT          NULL,
    uploaded_by  VARCHAR(36)  NULL,      -- users.id. FK를 걸지 않는다(계정을 지워도 기록은 남는다)
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_hygiene_photo_key (r2_key),
    KEY idx_hygiene_photos_check (check_id),
    CONSTRAINT fk_hygiene_photo_check FOREIGN KEY (check_id) REFERENCES hygiene_checks (id) ON DELETE CASCADE
);
