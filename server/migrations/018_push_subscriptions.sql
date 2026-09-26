-- 웹 푸시 구독. 탭이 닫혀 있어도 알림을 보내기 위한 것.
--
-- 소켓으로 보내는 알림은 앱 탭이 열려 있을 때만 뜬다. 관리자는 매장에 계속 앉아 화면을
-- 보고 있지 않으므로 그것만으로는 놓친다. 서비스 워커가 브라우저 백그라운드에서 받아
-- 띄우면 탭을 닫아도 알림이 온다.
--
-- endpoint가 구독의 신원이다(브라우저가 기기·프로필마다 다른 URL을 준다). 같은 사람이
-- 여러 기기를 쓰면 행이 여러 개 생기는 것이 정상이다.
--
-- p256dh/auth는 브라우저가 준 암호화 키다. 이것 없이는 푸시 본문을 만들 수 없다.
-- 서버가 가진 VAPID 비밀키와 짝이 맞아야 푸시 서비스가 받아준다 — VAPID 키를 바꾸면
-- 기존 구독은 전부 무효가 되므로 이 표를 비워야 한다.
--
-- user_id를 두는 이유: '관리자에게만' 같은 대상 고르기를 보낼 때 판단한다. 역할은 바뀔 수
-- 있으므로 구독에 역할을 복사해 두지 않고, 보낼 때 users와 조인해 그 시점의 역할을 본다.
--
--
-- ⚠️ user_id의 collation을 users.id에 맞춰 못박는다.
-- users는 오래된 표라 utf8mb4_general_ci인데, 요즘 만드는 표는 DB 기본값인 utf8mb4_0900_ai_ci가
-- 붙는다. 그 상태로 `JOIN users u ON u.id = s.user_id`를 하면 다음 오류로 조회 자체가 실패한다.
--     Illegal mix of collations ... for operation '='
-- passkeys.user_id도 같은 이유로 general_ci로 맞춰져 있다(003의 menu_recipes.menu_id 주석 참고).
-- hygiene_*·inventory_counts의 사용자 id 컬럼은 users와 조인하지 않는 스냅샷이라 그대로 두었지만,
-- 나중에 그 표들을 users와 이으려면 같은 문제를 만나게 된다.
-- 만료된 구독(브라우저가 404/410을 주는 것)은 보낼 때 발견해서 지운다. 따로 청소하는
-- 작업을 두지 않는다 — 어차피 보낼 때마다 확인되고, 안 쓰는 행이 남아도 해가 없다.

CREATE TABLE IF NOT EXISTS push_subscriptions
(
    id         INT AUTO_INCREMENT PRIMARY KEY,
    endpoint   VARCHAR(500) NOT NULL,
    p256dh     VARCHAR(255) NOT NULL,
    auth_key   VARCHAR(255) NOT NULL,
    user_id    VARCHAR(36) COLLATE utf8mb4_general_ci NULL, -- users.id와 같은 collation이어야 조인된다(위 주석)
    user_agent VARCHAR(255) NULL,                              -- 어느 기기인지 사람이 알아보기 위한 참고값
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_sent  DATETIME     NULL,
    UNIQUE KEY uq_push_endpoint (endpoint(255)),
    KEY idx_push_user (user_id)
);
