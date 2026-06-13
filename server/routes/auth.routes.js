const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const {authenticateToken, requireAdmin} = require("../middlewares/auth");
const debugInfo = require("../utils/debugInfo");

const JWT_SECRET = process.env.JWT_SECRET;

router.post('/register', async (req, res) => {
    const {username, password, name} = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)',
            [username, hashedPassword, name, 'pending']
        );
        res.json({success: true, message: '가입 신청 완료 (관리자에게 가입 승인을 요청하세요.)'});
    } catch (err) {
        console.error(`[🔥 POST /api/register 에러] 시도 아이디: ${username}`, err);
        res.status(500).json({
            success: false,
            message: '중복 아이디 또는 오류 발생',
            debug_info: debugInfo(err)
        });
    }
});

router.post('/login', async (req, res) => {
    const {username, password} = req.body;
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);

        if (users.length === 0 || !(await bcrypt.compare(password, users[0].password))) {
            return res.status(401).json({success: false, message: '아이디/비번 불일치'});
        }

        const user = users[0];
        if (user.role === 'pending') {
            return res.status(403).json({success: false, message: '승인 대기 중입니다.'});
        }

        const token = jwt.sign(
            {id: user.id, username: user.username, role: user.role, name: user.name},
            JWT_SECRET,
            {expiresIn: '12h'}
        );

        res.json({success: true, token, role: user.role, name: user.name, username: user.username, id: user.id});
    } catch (err) {
        console.error(`[🔥 POST /api/login 에러] 시도 아이디: ${username}`, err);
        res.status(500).json({
            success: false,
            message: '서버 에러',
            debug_info: debugInfo(err)
        });
    }
});

router.patch('/users/:id/password', authenticateToken, async (req, res) => {
    const {id} = req.params;
    const {currentPassword, newPassword} = req.body;

    try {
        const [users] = await pool.query('SELECT password FROM users WHERE id = ?', [id]);
        if (users.length === 0) {
            return res.status(404).json({success: false, message: '유저를 찾을 수 없습니다.'});
        }

        const user = users[0];
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(401).json({success: false, message: '현재 비밀번호가 틀렸습니다.'});
        }

        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password = ? WHERE id = ?', [hashedNewPassword, id]);

        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 PATCH /api/users/${id}/password 에러]`, err);
        res.status(500).json({
            success: false,
            message: '서버 에러',
            debug_info: debugInfo(err)
        });
    }
});

router.get('/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, username, name, role, created_at FROM users');
        res.json(rows);
    } catch (err) {
        console.error('[🔥 GET /api/admin/users 에러]', err);
        res.status(500).json({
            success: false,
            message: '유저 목록을 불러오지 못했습니다.',
            debug_info: debugInfo(err)
        });
    }
});

router.patch('/admin/users/:id/role', authenticateToken, requireAdmin, async (req, res) => {
    const {id} = req.params;
    const {role} = req.body;
    try {
        await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, id]);
        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 PATCH /api/admin/users/${id}/role 에러] 변경 시도 역할: ${role}`, err);
        res.status(500).json({
            success: false,
            message: '권한 변경에 실패했습니다.',
            debug_info: debugInfo(err)
        });
    }
});

router.delete('/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    const {id} = req.params;
    try {
        await pool.query('DELETE FROM users WHERE id = ?', [id]);
        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 DELETE /api/admin/users/${id} 에러]`, err);
        res.status(500).json({
            success: false,
            message: '계정 삭제 실패',
            debug_info: debugInfo(err)
        });
    }
});

module.exports = router;