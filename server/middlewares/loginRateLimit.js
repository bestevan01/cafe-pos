// 로그인 무차별 대입(brute-force) 방어용 rate limiter — DB 기반.
// IP별 '실패 횟수'를 고정 윈도우로 추적하고, 성공 시 카운터를 비웁니다.
// 인메모리 Map 대신 DB(login_attempts)에 두어 서버 재시작·스케일아웃에도 카운터가 유지됩니다.
// DB 오류 시에는 fail-open(로그인 자체를 막지 않음)으로 동작합니다.
const pool = require('../config/db');

const WINDOW_SEC = 10 * 60; // 10분
const MAX_FAILURES = 8;     // 윈도우 내 최대 실패 허용치

const getKey = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

// 차단 여부 검사 미들웨어. 막혀야 하면 429, 아니면 통과.
const loginRateLimiter = async (req, res, next) => {
    const key = getKey(req);
    req.loginKey = key; // 라우트에서 성공/실패를 기록할 때 사용
    try {
        const [rows] = await pool.query(
            `SELECT failures, GREATEST(0, TIMESTAMPDIFF(SECOND, NOW(), reset_at)) AS remaining_sec
             FROM login_attempts
             WHERE attempt_key = ?
               AND reset_at > NOW()`,
            [key]
        );
        if (rows.length && rows[0]['failures'] >= MAX_FAILURES) {
            const waitMin = Math.max(1, Math.ceil(rows[0]['remaining_sec'] / 60));
            return res.status(429).json({
                success: false,
                message: `로그인 시도가 너무 많습니다. 약 ${waitMin}분 후 다시 시도해주세요.`
            });
        }
    } catch (err) {
        // DB 장애로 전 직원이 로그인 못 하는 사태를 막기 위해 통과시킨다.
        console.error('[⚠️ 레이트리밋 검사 실패 — 통과 처리]', err.message);
    }
    next();
};

// 실패 1회 기록. 윈도우가 만료됐으면 새 윈도우로 리셋(원자적 upsert).
const recordLoginFailure = async (key) => {
    try {
        await pool.query(
            `INSERT INTO login_attempts (attempt_key, failures, reset_at)
             VALUES (?, 1, DATE_ADD(NOW(), INTERVAL ? SECOND))
             ON DUPLICATE KEY UPDATE failures = IF(reset_at <= NOW(), 1, failures + 1),
                                     reset_at = IF(reset_at <= NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND), reset_at)`,
            [key, WINDOW_SEC, WINDOW_SEC]
        );
        // 만료 행 가끔 청소(별도 타이머 불필요)
        if (Math.random() < 0.05) {
            await pool.query('DELETE FROM login_attempts WHERE reset_at < NOW()');
        }
    } catch (err) {
        console.error('[⚠️ 로그인 실패 기록 실패]', err.message);
    }
};

// 성공 시 해당 키의 카운터 제거.
const recordLoginSuccess = async (key) => {
    try {
        await pool.query('DELETE FROM login_attempts WHERE attempt_key = ?', [key]);
    } catch (err) {
        console.error('[⚠️ 로그인 성공 기록 실패]', err.message);
    }
};

module.exports = {loginRateLimiter, recordLoginFailure, recordLoginSuccess};
