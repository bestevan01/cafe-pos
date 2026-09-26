-- 정해진 시각에 브라우저 알림을 띄우는 공통 장치.
--
-- 처음 쓰는 곳은 재고 조사의 '주문 필요' 알림이지만, 특정 기능에 묶지 않는다.
-- 위생 점검을 안 낸 날 알리거나, 마감 정산을 잊었을 때 알리는 식으로 쓸 곳이 더 있다.
-- 그래서 표에는 '무엇을 알릴지'가 아니라 '어떤 알림을 몇 시에 켤지'만 담는다.
-- 알림 내용은 코드 쪽 레지스트리(utils/alerts.js)가 alert_key로 만든다.
--
-- 한 key에 시각을 여러 개 둘 수 있다. 아침에 한 번, 마감 전에 한 번 받고 싶을 수 있다.
--
-- last_fired_date를 두는 이유: 스케줄러가 1분마다 도는데, 표시를 안 남기면 그 시각 이후
-- 매 분 알림이 나간다. 하루 한 번만 나가도록 막는다.
--
-- ⚠️ 시각 비교는 반드시 DB에게 맡긴다(CURTIME/CURDATE). 배포 서버는 UTC로 돌아서
-- JS의 new Date()로 비교하면 9시간 어긋난다(utils/kstDate.js 참고).

CREATE TABLE IF NOT EXISTS alert_schedules
(
    id              INT AUTO_INCREMENT PRIMARY KEY,
    alert_key       VARCHAR(50) NOT NULL,              -- 코드 레지스트리의 키. 예: inventory_low
    run_at          TIME        NOT NULL,              -- 알릴 시각(한국 시각)
    is_enabled      TINYINT(1)  NOT NULL DEFAULT 1,
    last_fired_date DATE        NULL,                  -- 오늘 이미 나갔는지
    created_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_alert_key_time (alert_key, run_at),
    KEY idx_alert_enabled (is_enabled, run_at)
);
