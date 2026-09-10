const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const JWT_SECRET = /** @type {string} */ (process.env.JWT_SECRET);

/**
 * 토큰을 검증하고, 토큰에 적힌 신원이 지금도 유효한지 DB로 확인한다.
 *
 * JWT는 한 번 발급하면 회수할 수 없는 종이 출입증이라, 서명만 보면 발급 이후의 변화를
 * 알 수 없다. role이 토큰 안에 박혀 나가므로, 서명만 믿으면 이런 일이 생긴다:
 *   - 권한을 바꿔도 그 사람은 만료(12시간) 전까지 이전 권한으로 계속 동작한다
 *   - 관리자에서 강등해도 관리자 API를 계속 호출할 수 있다
 *   - 계정을 삭제해도 토큰만 있으면 계속 주문을 받는다 (users에 행이 없는데도)
 * 소켓으로 '로그아웃하라'고 알리는 것은 부탁이지 차단이 아니다 — 접속해 있지 않으면
 * 못 받고, 토큰만 있으면 화면 없이 curl로도 된다. 서버가 안 받아줘야 끝난다.
 *
 * 그래서 매 요청 users를 조회해 role을 DB 값으로 덮어쓴다. users는 행이 몇 개뿐이고
 * PK 조회라 비용이 사실상 없다. 요청도 직원이 실제로 누르는 만큼만 발생한다(폴링 없음).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: '로그인이 필요합니다.' });

    jwt.verify(token, JWT_SECRET, async (/** @type {any} */ err, /** @type {any} */ payload) => {
        // 만료·무효 토큰은 401(인증 실패) — 클라이언트가 권한부족(403)과 구분해 재로그인을 유도한다.
        if (err) {
            // 만료(TokenExpiredError)와 위조(JsonWebTokenError)를 구분해 남긴다.
            console.warn(`[🔒 인증 거부] ${err.name}: ${err.message} — ${req.method} ${req.originalUrl}`);
            return res.status(401).json({ message: '유효하지 않은 토큰입니다.' });
        }

        try {
            const [rows] = await pool.query('SELECT id, username, name, role FROM users WHERE id = ?', [payload.id]);
            if (rows.length === 0) {
                // 계정이 지워졌다. 토큰은 아직 안 만료됐지만 더 이상 사용자가 아니다.
                // 로그를 남기는 이유: 사용자에게는 '세션 만료'로만 보여서, 남기지 않으면
                // 왜 튕겼는지 사후에 알 방법이 없다.
                console.warn(
                    `[🔒 인증 거부] 계정 없음 — id=${payload.id} username=${payload.username} ${req.method} ${req.originalUrl}`,
                );
                return res.status(401).json({ message: '계정을 찾을 수 없습니다. 다시 로그인해주세요.' });
            }
            // 승인 대기로 되돌린 사람은 더 이상 직원이 아니다. 로그인 시점에는 막고 있었지만
            // 이미 로그인한 사람은 아무도 확인하지 않아, 되돌려도 계속 주문을 받을 수 있었다.
            if (rows[0].role === 'pending') {
                console.warn(
                    `[🔒 인증 거부] 승인 대기 — username=${rows[0].username} ${req.method} ${req.originalUrl}`,
                );
                return res.status(401).json({ message: '승인 대기 상태입니다. 관리자에게 문의하세요.' });
            }
            // 토큰에 적힌 role이 아니라 지금 DB의 role을 쓴다. 권한 변경이 즉시 반영된다.
            req.user = rows[0];
            next();
        } catch (/** @type {any} */ dbErr) {
            // DB가 잠시 흔들렸다고 전원을 로그아웃시키면 안 된다. 401이 아니라 503으로 답해
            // 클라이언트가 '재로그인'이 아니라 '잠시 후 재시도'로 받아들이게 한다.
            console.error('[🔥 인증 중 DB 조회 실패]', dbErr.message);
            return res.status(503).json({ message: '일시적인 오류입니다. 잠시 후 다시 시도해주세요.' });
        }
    });
};

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: '관리자 권한이 필요합니다.' });
    }
    next();
};

module.exports = {
    authenticateToken,
    requireAdmin,
};
