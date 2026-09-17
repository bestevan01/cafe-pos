const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken } = require('../middlewares/auth');
const debugInfo = require('../utils/debugInfo');
const { listAlertTypes } = require('../utils/alerts');

// '내가 받는 알림' 조회. 로그인한 사람이면 누구나 — 단, 자기 역할이 받는 알림만 보인다.
//
// 알림을 켜고 끄는 권한은 관리자에게 있다(매장 단위 설정). 근무자는 그 결과를 볼 수만 있다.
// 근무자 화면에 '받습니다'라는 문구를 박아 두면, 관리자가 꺼 둬도 받는다고 나온다.
// 실제 상태와 시각을 보여줘야 '왜 알림이 안 오지?'에 스스로 답할 수 있다.
router.use(authenticateToken);

router.get('', async (req, res) => {
    const role = req.user.role;
    const mine = listAlertTypes().filter((t) => t.audience === role || t.audience === 'all');
    if (mine.length === 0) return res.json([]);

    try {
        const [rows] = await pool.query(
            `SELECT alert_key, TIME_FORMAT(run_at, '%H:%i') AS run_at, is_enabled
             FROM alert_schedules
             WHERE alert_key IN (?)
             ORDER BY run_at`,
            [mine.map((t) => t.key)],
        );
        res.json(
            mine.map((t) => {
                const times = rows.filter((/** @type {any} */ r) => r.alert_key === t.key);
                return {
                    key: t.key,
                    label: t.label,
                    description: t.description,
                    // 켜진 시각만 알려준다. 꺼진 시각까지 보이면 '이 시각에도 오나?' 헷갈린다.
                    times: times.filter((/** @type {any} */ r) => r.is_enabled).map((/** @type {any} */ r) => r.run_at),
                    enabled: times.some((/** @type {any} */ r) => r.is_enabled),
                };
            }),
        );
    } catch (/** @type {any} */ err) {
        console.error('[🔥 GET /api/alerts/mine 에러]', err);
        res.status(500).json({
            success: false,
            message: '알림 정보를 불러오지 못했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

module.exports = router;
