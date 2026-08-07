const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { authenticateToken, requireAdmin } = require('../middlewares/auth');
const debugInfo = require('../utils/debugInfo');
const { loginRateLimiter, recordLoginFailure, recordLoginSuccess } = require('../middlewares/loginRateLimit');
const { isStrongPassword, PASSWORD_POLICY_MESSAGE } = require('../utils/passwordPolicy');

const JWT_SECRET = /** @type {string} */ (process.env.JWT_SECRET);
const VALID_ROLES = ['admin', 'staff', 'pending'];

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

        res.json({ success: true, token, role: user.role, name: user.name, username: user.username, id: user.id });
    } catch (/** @type {any} */ err) {
        console.error(`[🔥 POST /api/login 에러] 시도 아이디: ${username}`, err);
        res.status(500).json({
            success: false,
            message: '서버 에러',
            debug_info: debugInfo(err),
        });
    }
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
        await pool.query('UPDATE users SET password = ? WHERE id = ?', [hashedNewPassword, id]);

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
        const [rows] = await pool.query('SELECT id, username, name, role, created_at FROM users');
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
