const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken, requireAdmin } = require('../middlewares/auth');
const debugInfo = require('../utils/debugInfo');
const { listAlertTypes, fireAlert } = require('../utils/alerts');

// 알림 시각 설정. 관리자 전용.
// '무엇을 알릴지'는 코드가 정하고(utils/alerts.js 레지스트리), 여기서는 '몇 시에 켤지'만 다룬다.
router.use(authenticateToken, requireAdmin);

/** 'HH:MM'만 통과시킨다. 초 단위까지 받을 이유가 없다. */
const asTime = (/** @type {any} */ v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v ?? '')) ? String(v) : null);

// 쓸 수 있는 알림 종류 + 지금 걸린 시각들
router.get('', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, alert_key, TIME_FORMAT(run_at, '%H:%i') AS run_at, is_enabled,
                    DATE_FORMAT(last_fired_date, '%Y-%m-%d') AS last_fired_date
             FROM alert_schedules
             ORDER BY alert_key, run_at`,
        );
        res.json({ types: listAlertTypes(), schedules: rows });
    } catch (/** @type {any} */ err) {
        console.error('[🔥 GET /api/admin/alerts 에러]', err);
        res.status(500).json({
            success: false,
            message: '알림 설정을 불러오지 못했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

router.post('', async (req, res) => {
    const key = String(req.body.alert_key ?? '');
    const runAt = asTime(req.body.run_at);
    const type = listAlertTypes().find((t) => t.key === key);
    if (!type) {
        return res.status(400).json({ success: false, message: '알 수 없는 알림 종류입니다.' });
    }
    // 재고 조사 알림처럼 다른 설정의 시각을 따라가는 알림은 여기서 시각을 늘리지 않는다.
    // 손으로 넣은 시각은 다음 동기화 때 지워져, 사용자에게는 설정이 사라진 것처럼 보인다.
    if (type.managed) {
        return res.status(400).json({ success: false, message: '이 알림의 시각은 다른 설정을 따라갑니다.' });
    }
    if (!runAt) return res.status(400).json({ success: false, message: '시각을 HH:MM으로 입력해주세요.' });

    try {
        // 오늘 이 시각이 이미 지났다면 오늘치는 보낸 것으로 표시해 둔다.
        // 안 그러면 방금 등록한 알림이 유예 시간 안이라며 바로 울린다.
        const [r] = await pool.query(
            `INSERT INTO alert_schedules (alert_key, run_at, last_fired_date)
             VALUES (?, ?, IF(? <= CURTIME(), CURDATE(), NULL))`,
            [key, runAt, runAt],
        );
        res.json({ success: true, id: r.insertId });
    } catch (/** @type {any} */ err) {
        if (err && err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: '이미 같은 시각이 등록돼 있습니다.' });
        }
        console.error('[🔥 POST /api/admin/alerts 에러]', err);
        res.status(500).json({
            success: false,
            message: '알림 시각을 추가하지 못했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

// 알림 종류 하나를 통째로 켜고 끈다. 시각이 여러 개인 알림을 하나씩 끄게 하면 번거롭다.
router.patch('/key/:key', async (req, res) => {
    if (req.body.is_enabled === undefined) return res.json({ success: true });
    try {
        const on = req.body.is_enabled ? 1 : 0;
        // 켤 때는 이미 지난 시각을 오늘 처리로 둔다. 켜는 순간 몰아서 울리면 안 된다.
        await pool.query(
            `UPDATE alert_schedules
             SET is_enabled = ?, last_fired_date = IF(? = 1 AND run_at <= CURTIME(), CURDATE(), last_fired_date)
             WHERE alert_key = ?`,
            [on, on, req.params.key],
        );
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        console.error(`[🔥 PATCH /api/admin/alerts/key/${req.params.key} 에러]`, err);
        res.status(500).json({ success: false, message: '알림 설정을 바꾸지 못했습니다.', debug_info: debugInfo(err) });
    }
});

router.patch('/:id', async (req, res) => {
    if (req.body.is_enabled === undefined) return res.json({ success: true });
    try {
        // 다시 켤 때는 오늘치를 보낸 것으로 표시한다. 껐다 켜는 것만으로 알림이 울리면 안 된다.
        await pool.query(
            `UPDATE alert_schedules
             SET is_enabled = ?, last_fired_date = IF(? = 1 AND run_at <= CURTIME(), CURDATE(), last_fired_date)
             WHERE id = ?`,
            [req.body.is_enabled ? 1 : 0, req.body.is_enabled ? 1 : 0, req.params.id],
        );
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        console.error(`[🔥 PATCH /api/admin/alerts/${req.params.id} 에러]`, err);
        res.status(500).json({ success: false, message: '알림 설정을 바꾸지 못했습니다.', debug_info: debugInfo(err) });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        // 코드가 시각을 맞추는 알림은 지우지 못하게 한다. 지워도 다음 동기화 때 다시 생겨서
        // 사용자에게는 '지웠는데 되살아난' 것처럼 보인다. 끄려면 켜기/끄기를 쓴다.
        const [[row]] = await pool.query('SELECT alert_key FROM alert_schedules WHERE id = ?', [req.params.id]);
        if (row && listAlertTypes().find((t) => t.key === row.alert_key)?.managed) {
            return res
                .status(400)
                .json({ success: false, message: '이 알림은 지울 수 없습니다. 끄기를 사용해주세요.' });
        }
        await pool.query('DELETE FROM alert_schedules WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        console.error(`[🔥 DELETE /api/admin/alerts/${req.params.id} 에러]`, err);
        res.status(500).json({ success: false, message: '알림 시각을 지우지 못했습니다.', debug_info: debugInfo(err) });
    }
});

// 지금 보내보기. 시각을 기다리지 않고 문구와 브라우저 권한을 확인할 수 있다.
// 누른 사람에게만 보낸다 — 시험 삼아 누른 알림이 다른 사람 화면에 뜨면 안 된다.
router.post('/:key/test', async (req, res) => {
    try {
        const socketId = String(req.body.socket_id ?? '');
        if (!socketId) return res.status(400).json({ success: false, message: '연결 정보가 없습니다.' });
        const result = await fireAlert(req.app.get('io'), req.params.key, { socketId });
        res.json({ success: result.sent, message: result.reason ?? null, payload: result.payload ?? null });
    } catch (/** @type {any} */ err) {
        console.error(`[🔥 POST /api/admin/alerts/${req.params.key}/test 에러]`, err);
        res.status(500).json({ success: false, message: '알림을 보내보지 못했습니다.', debug_info: debugInfo(err) });
    }
});

module.exports = router;
