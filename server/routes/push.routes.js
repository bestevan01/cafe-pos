const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken } = require('../middlewares/auth');
const debugInfo = require('../utils/debugInfo');
const push = require('../config/push');

// 웹 푸시 구독 관리. 로그인한 사람이면 누구나 자기 기기를 등록한다 —
// 지금은 관리자만 받는 알림뿐이지만, 직원 대상 알림이 생기면 그대로 쓴다.
router.use(authenticateToken);

// 공개키. 브라우저가 구독을 만들 때 필요하다(비밀키는 서버만 가진다).
router.get('/key', (req, res) => {
    if (!push.isConfigured) {
        return res.status(503).json({ success: false, message: '푸시 알림이 설정되지 않았습니다.' });
    }
    res.json({ success: true, key: push.publicKey });
});

router.post('/subscribe', async (req, res) => {
    const sub = req.body.subscription;
    const endpoint = String(sub?.endpoint ?? '');
    const p256dh = String(sub?.keys?.p256dh ?? '');
    const auth = String(sub?.keys?.auth ?? '');
    if (!endpoint || !p256dh || !auth) {
        return res.status(400).json({ success: false, message: '구독 정보가 올바르지 않습니다.' });
    }
    try {
        // 같은 기기가 다시 등록하면 덮어쓴다. 브라우저가 구독을 갱신하면 키가 바뀔 수 있고,
        // 다른 계정으로 로그인하면 주인도 바뀌어야 한다.
        await pool.query(
            `INSERT INTO push_subscriptions (endpoint, p256dh, auth_key, user_id, user_agent)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE p256dh = VALUES(p256dh), auth_key = VALUES(auth_key),
                                     user_id = VALUES(user_id), user_agent = VALUES(user_agent)`,
            [endpoint, p256dh, auth, req.user.id, String(req.headers['user-agent'] ?? '').slice(0, 255)],
        );
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        console.error('[🔥 POST /api/push/subscribe 에러]', err);
        res.status(500).json({ success: false, message: '알림 등록에 실패했습니다.', debug_info: debugInfo(err) });
    }
});

router.post('/unsubscribe', async (req, res) => {
    const endpoint = String(req.body.endpoint ?? '');
    if (!endpoint) return res.status(400).json({ success: false, message: '구독 정보가 없습니다.' });
    try {
        await pool.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        console.error('[🔥 POST /api/push/unsubscribe 에러]', err);
        res.status(500).json({ success: false, message: '알림 해제에 실패했습니다.', debug_info: debugInfo(err) });
    }
});

// 이 기기가 등록돼 있는지. 브라우저 구독은 살아 있는데 서버에 없는 경우가 있다
// (다른 기기에서 지웠거나, DB를 비웠거나). 화면이 상태를 정확히 보여주려면 물어봐야 한다.
router.post('/status', async (req, res) => {
    const endpoint = String(req.body.endpoint ?? '');
    if (!endpoint) return res.json({ registered: false, configured: push.isConfigured });
    try {
        const [[row]] = await pool.query('SELECT id FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
        res.json({ registered: Boolean(row), configured: push.isConfigured });
    } catch (/** @type {any} */ err) {
        console.error('[🔥 POST /api/push/status 에러]', err);
        res.status(500).json({ success: false, message: '상태를 확인하지 못했습니다.', debug_info: debugInfo(err) });
    }
});

module.exports = router;
