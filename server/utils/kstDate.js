/**
 * 한국 기준 날짜 문자열(YYYY-MM-DD).
 *
 * Node 프로세스의 시간대를 쓰지 않는다. 배포된 서버(Render)는 UTC로 돌기 때문에
 * new Date().toISOString()으로 날짜를 뽑으면 한국 시간 자정~오전 9시에는 전날이 나온다.
 * DB 커넥션은 +09:00으로 고정돼 있어 CURDATE()·NOW()는 한국 기준인데, JS만 UTC라 어긋난다.
 *
 * ⚠️ 기록으로 남는 날짜·시각은 이 함수가 아니라 DB에서 뽑는 것이 원칙이다(CURDATE, NOW).
 * 같은 문장 안에서 뽑아야 경계 시각에도 서로 어긋나지 않는다. 이 함수는 조회 기본값이나
 * 파일 키처럼 DB 값과 원자적으로 맞을 필요가 없는 곳에만 쓴다.
 *
 * 한국은 서머타임이 없어 고정 +9시간으로 계산해도 어긋나지 않는다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** @param {number} [offsetDays] 오늘 기준 며칠 전/후 */
const kstDate = (offsetDays = 0) =>
    new Date(Date.now() + KST_OFFSET_MS + offsetDays * 86400000).toISOString().slice(0, 10);

module.exports = { kstDate };
