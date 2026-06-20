// 로그인 무차별 대입(brute-force) 방어용 인메모리 rate limiter.
// IP별 '실패 횟수'를 슬라이딩 윈도우로 추적하고, 성공 시 카운터를 비웁니다.
// (Render 단일 인스턴스 가정. 다중 인스턴스로 확장 시 Redis 등 공유 저장소 필요)
const WINDOW_MS = 10 * 60 * 1000; // 10분
const MAX_FAILURES = 8;           // 윈도우 내 최대 실패 허용치

const attempts = new Map(); // key(IP) -> { failures, resetAt }

const getKey = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

const loginRateLimiter = (req, res, next) => {
    const key = getKey(req);
    const rec = attempts.get(key);

    if (rec && rec.resetAt > Date.now() && rec.failures >= MAX_FAILURES) {
        const waitMin = Math.ceil((rec.resetAt - Date.now()) / 60000);
        return res.status(429).json({
            success: false,
            message: `로그인 시도가 너무 많습니다. 약 ${waitMin}분 후 다시 시도해주세요.`
        });
    }

    req.loginKey = key; // 라우트에서 성공/실패를 기록할 때 사용
    next();
};

const recordLoginFailure = (key) => {
    const now = Date.now();
    const rec = attempts.get(key);
    if (!rec || rec.resetAt <= now) {
        attempts.set(key, {failures: 1, resetAt: now + WINDOW_MS});
    } else {
        rec.failures += 1;
    }
};

const recordLoginSuccess = (key) => {
    attempts.delete(key);
};

// 만료된 항목 주기적 정리 (메모리 누수 방지). unref로 프로세스 종료를 막지 않음.
const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of attempts) {
        if (v.resetAt <= now) attempts.delete(k);
    }
}, WINDOW_MS);
if (cleanup.unref) cleanup.unref();

module.exports = {loginRateLimiter, recordLoginFailure, recordLoginSuccess};
