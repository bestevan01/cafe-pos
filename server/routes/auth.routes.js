const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { authenticateToken, requireAdmin } = require('../middlewares/auth');
const { generateTempPassword } = require('../utils/tempPassword');
const debugInfo = require('../utils/debugInfo');
const { loginRateLimiter, recordLoginFailure, recordLoginSuccess } = require('../middlewares/loginRateLimit');
const { isStrongPassword, PASSWORD_POLICY_MESSAGE } = require('../utils/passwordPolicy');
const { releaseKitchenOnLogout } = require('../sockets/socketHandlers');

const JWT_SECRET = /** @type {string} */ (process.env.JWT_SECRET);
const VALID_ROLES = ['admin', 'staff', 'pending'];

/**
 * 해당 사용자의 열려 있는 소켓을 즉시 끊는다.
 *
 * HTTP는 다음 요청에서 걸러지지만 소켓은 연결할 때 한 번만 확인한다. 이미 붙어 있는
 * 연결은 계속 살아 있어서, 권한을 잃은 사람이 캐셔 점유 같은 소켓 동작을 이어갈 수 있다.
 * 끊어 주면 클라이언트가 재연결을 시도하고, 그때 핸드셰이크에서 정상적으로 막힌다.
 *
 * @param {import('express').Request} req
 * @param {string} userId
 */
function disconnectUserSockets(req, userId) {
    const io = req.app.get('io');
    if (!io) return;
    for (const socket of io.sockets.sockets.values()) {
        if (socket.data?.user?.id === userId) socket.disconnect(true);
    }
}

router.post('/register', async (req, res) => {
    const { username, password, name } = req.body;
    try {
        if (!isStrongPassword(password)) {
            return res.status(400).json({ success: false, message: PASSWORD_POLICY_MESSAGE });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)', [
            username,
            hashedPassword,
            name,
            'pending',
        ]);
        res.json({ success: true, message: '가입 신청 완료 (관리자에게 가입 승인을 요청하세요.)' });
    } catch (/** @type {any} */ err) {
        console.error(`[🔥 POST /api/register 에러] 시도 아이디: ${username}`, err);
        res.status(500).json({
            success: false,
            message: '중복 아이디 또는 오류 발생',
            debug_info: debugInfo(err),
        });
    }
});

router.post('/login', loginRateLimiter, async (req, res) => {
    const { username, password } = req.body;
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);

        if (users.length === 0 || !(await bcrypt.compare(password, users[0].password))) {
            await recordLoginFailure(req.loginKey ?? 'unknown');
            return res.status(401).json({ success: false, message: '아이디 혹은 비밀번호가 일치하지 않습니다.' });
        }

        await recordLoginSuccess(req.loginKey ?? 'unknown'); // 비밀번호 일치 → 실패 카운터 초기화
        const user = users[0];
        if (user.role === 'pending') {
            return res.status(403).json({ success: false, message: '승인 대기 중입니다.' });
        }

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role, name: user.name }, JWT_SECRET, {
            expiresIn: '12h',
        });

        res.json({
            success: true,
            token,
            role: user.role,
            name: user.name,
            username: user.username,
            id: user.id,
            // 관리자가 임시 비밀번호를 발급한 계정이면 클라이언트가 변경 화면을 강제로 띄운다.
            mustChangePassword: user.must_change_password === 1,
        });
    } catch (/** @type {any} */ err) {
        console.error(`[🔥 POST /api/login 에러] 시도 아이디: ${username}`, err);
        res.status(500).json({
            success: false,
            message: '서버 에러',
            debug_info: debugInfo(err),
        });
    }
});

/**
 * 토큰이 지금도 유효한지 확인하는 용도. 소켓 핸드셰이크가 인증 실패로 거부됐을 때,
 * 정말 세션이 죽은 것인지 소켓만 일시적으로 막힌 것인지 클라이언트가 여기로 되묻는다.
 *
 * 소켓 거부 하나로 곧바로 로그아웃시키면, 네트워크가 불안정한 매장에서 근무 중에
 * 튕겨 나간다. 토큰의 생사는 HTTP가 권위 있게 답한다 — 같은 authenticateToken을 타므로
 * 소켓이 내렸을 판단과 정확히 같은 결론이 나온다.
 *
 * 응답은 최소한만 담는다. 재연결 때마다 불릴 수 있어 가벼워야 한다.
 */
router.get('/me', authenticateToken, (req, res) => {
    res.json({ success: true, role: req.user.role, username: req.user.username });
});

/**
 * 로그아웃 알림. 토큰은 클라이언트가 지우므로 서버가 할 일은 실시간 자리(주방 인원)를 비우는 것뿐이다.
 * 소켓 'logout'은 연결이 끊겨 있으면 전달되지 않아 HTTP로도 받는다(sockets/socketHandlers.js 참고).
 * 둘 다 도착해도 결과는 같다.
 */
router.post('/logout', authenticateToken, (req, res) => {
    const socketId = typeof req.body?.socket_id === 'string' ? req.body.socket_id : null;
    releaseKitchenOnLogout(req.user.username, socketId);
    res.json({ success: true });
});

router.patch('/users/:id/password', authenticateToken, async (req, res) => {
    // 본인 비밀번호만 변경 가능. URL의 :id가 아닌 인증된 사용자 ID를 사용해 타인 비번 변경(IDOR)을 차단한다.
    // 현재 비밀번호 확인은 '내 정보' 진입 시 ProfileAuth(비밀번호/패스키 재인증)로 이미 대체되었다.
    const id = req.user.id;
    const { newPassword } = req.body;

    try {
        if (!isStrongPassword(newPassword)) {
            return res.status(400).json({ success: false, message: PASSWORD_POLICY_MESSAGE });
        }

        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        // 본인이 새 비밀번호를 정했으므로 임시 비밀번호 표시를 함께 내린다.
        await pool.query('UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?', [
            hashedNewPassword,
            id,
        ]);

        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        console.error(`[🔥 PATCH /api/users/${id}/password 에러]`, err);
        res.status(500).json({
            success: false,
            message: '서버 에러',
            debug_info: debugInfo(err),
        });
    }
});

router.get('/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(
            // 클라이언트가 권한별로 묶어 표시하므로 서버에서도 같은 순서로 내려준다.
            // (조치가 필요한 대기중 → 관리자 → 직원, 그룹 안에서는 이름순)
            `SELECT id, username, name, role, created_at
             FROM users
             ORDER BY FIELD(role, 'pending', 'admin', 'staff'), name`,
        );
        res.json(rows);
    } catch (/** @type {any} */ err) {
        console.error('[🔥 GET /api/admin/users 에러]', err);
        res.status(500).json({
            success: false,
            message: '유저 목록을 불러오지 못했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

// 관리자가 직원의 비밀번호를 임시 값으로 초기화한다.
// 이메일·휴대폰을 수집하지 않는 구조라 자동 재설정 링크를 보낼 수 없으므로,
// 관리자가 직원에게 직접 전달하는 방식을 택했다. 전달 과정 자체가 신원 확인 역할을 한다.
// 평문은 이 응답에서 딱 한 번만 나가고 DB에는 해시만 남는다(관리자도 다시 볼 수 없다).
router.post('/admin/users/:id/reset-password', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const [target] = await pool.query('SELECT username, name FROM users WHERE id = ?', [id]);
        if (target.length === 0) {
            return res.status(404).json({ success: false, message: '해당 직원을 찾을 수 없습니다.' });
        }

        const tempPassword = generateTempPassword();
        const hashed = await bcrypt.hash(tempPassword, 10);
        // must_change_password를 세워 다음 로그인 때 본인이 새 비밀번호를 정하도록 강제한다.
        await pool.query('UPDATE users SET password = ?, must_change_password = 1 WHERE id = ?', [hashed, id]);

        // 감사 추적용. 비밀번호 자체는 절대 로그에 남기지 않는다.
        console.log(`[🔑 비밀번호 초기화] 대상: ${target[0]['username']} / 처리자: ${req.user.username}`);

        res.json({ success: true, tempPassword, name: target[0]['name'], username: target[0]['username'] });
    } catch (/** @type {any} */ err) {
        console.error(`[🔥 POST /api/admin/users/${id}/reset-password 에러]`, err);
        res.status(500).json({
            success: false,
            message: '비밀번호 초기화에 실패했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

router.patch('/admin/users/:id/role', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;
    if (!VALID_ROLES.includes(role)) {
        return res.status(400).json({ success: false, message: '유효하지 않은 권한 값입니다.' });
    }
    try {
        // 마지막 관리자를 강등하면 관리자 접근이 영구 차단되므로 막는다.
        if (role !== 'admin') {
            const [target] = await pool.query('SELECT role FROM users WHERE id = ?', [id]);
            if (target.length === 0)
                return res.status(404).json({ success: false, message: '유저를 찾을 수 없습니다.' });
            if (target[0]['role'] === 'admin') {
                const [adminRows] = await pool.query("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'");
                if (Number(adminRows[0]['cnt']) <= 1) {
                    return res.status(400).json({ success: false, message: '마지막 관리자는 강등할 수 없습니다.' });
                }
            }
        }
        await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, id]);
        // 새 권한은 다음 요청부터 자동 적용된다(인증 미들웨어가 매번 DB를 본다).
        // 소켓은 연결 시 한 번만 확인하므로 여기서 직접 끊는다.
        disconnectUserSockets(req, String(id));
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        console.error(`[🔥 PATCH /api/admin/users/${id}/role 에러] 변경 시도 역할: ${role}`, err);
        res.status(500).json({
            success: false,
            message: '권한 변경에 실패했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

router.delete('/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    if (String(id) === String(req.user.id)) {
        return res.status(400).json({ success: false, message: '자기 자신의 계정은 삭제할 수 없습니다.' });
    }
    try {
        // 마지막 관리자 삭제로 관리자 접근이 영구 차단되는 것을 막는다.
        const [target] = await pool.query('SELECT role FROM users WHERE id = ?', [id]);
        if (target.length === 0) return res.status(404).json({ success: false, message: '유저를 찾을 수 없습니다.' });
        if (target[0]['role'] === 'admin') {
            const [adminRows] = await pool.query("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'");
            if (Number(adminRows[0]['cnt']) <= 1) {
                return res.status(400).json({ success: false, message: '마지막 관리자는 삭제할 수 없습니다.' });
            }
        }
        await pool.query('DELETE FROM users WHERE id = ?', [id]);
        disconnectUserSockets(req, String(id));
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        console.error(`[🔥 DELETE /api/admin/users/${id} 에러]`, err);
        res.status(500).json({
            success: false,
            message: '계정 삭제 실패',
            debug_info: debugInfo(err),
        });
    }
});

module.exports = router;
