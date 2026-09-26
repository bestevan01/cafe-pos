const webpush = require('web-push');
const pool = require('./db');
const { FRONTEND_ORIGIN, IS_PRODUCTION } = require('./frontend');

/**
 * 웹 푸시(탭이 닫혀 있어도 뜨는 알림).
 *
 * VAPID 키가 없으면 조용히 꺼진다 — R2 설정과 같은 방식이다. 키 없이 기동을 막으면
 * 로컬이나 새 매장에서 다른 기능까지 못 쓰게 된다. 소켓 알림은 키 없이도 그대로 동작한다.
 *
 * ⚠️ VAPID 키를 바꾸면 기존 구독이 전부 무효가 된다. 그때는 push_subscriptions를 비우고
 * 사용자들이 다시 '알림 허용'을 눌러야 한다.
 */
const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

/**
 * 발신자 연락처(RFC 8292). 푸시 서비스(Google·Apple·Mozilla)만 보고, 받는 사람에게는 보이지 않는다.
 * https: URL이나 mailto: 주소여야 하며, Apple은 없거나 형식이 틀리면 거부한다.
 *
 * 운영에서는 매장 사이트 주소(FRONTEND_ORIGIN)를 그대로 쓴다 — 매장마다 이미 따로 정해져 있어
 * 환경변수를 하나 더 둘 필요가 없고, FRONTEND_URL(https:// 없이)과 형식을 헷갈릴 일도 없다.
 * 로컬은 http://localhost라 규칙에 맞지 않으므로 mailto 기본값을 쓴다. VAPID_SUBJECT가 있으면 그 값이 우선.
 */
const SUBJECT = process.env.VAPID_SUBJECT || (IS_PRODUCTION ? FRONTEND_ORIGIN : 'mailto:admin@example.com');

let isConfigured = Boolean(PUBLIC_KEY && PRIVATE_KEY);
if (isConfigured) {
    try {
        webpush.setVapidDetails(SUBJECT, /** @type {string} */ (PUBLIC_KEY), /** @type {string} */ (PRIVATE_KEY));
    } catch (err) {
        // 값이 잘못돼도 서버 전체를 세우지 않는다 — 키가 없을 때와 똑같이 푸시만 끈다.
        isConfigured = false;
        console.warn(`⚠️ [푸시] VAPID 설정이 올바르지 않아 웹 푸시를 끕니다: ${/** @type {Error} */ (err).message}`);
    }
} else {
    console.warn('⚠️ [푸시] VAPID 키가 없어 웹 푸시가 꺼져 있습니다(소켓 알림은 그대로 동작).');
}

/**
 * 대상에게 푸시를 보낸다.
 *
 * 역할은 구독에 복사해 두지 않고 보낼 때 users와 조인해 확인한다 — 직원이 관리자가 되거나
 * 그 반대가 되었을 때, 옛 역할로 굳어 있으면 안 될 사람에게 알림이 간다.
 *
 * @param {'admin'|'staff'|'all'} audience
 * @param {{key?: string, title: string, body?: string}} payload
 * @returns {Promise<{sent: number, removed: number, skipped?: string}>}
 */
async function sendToAudience(audience, payload) {
    if (!isConfigured) return { sent: 0, removed: 0, skipped: 'VAPID 미설정' };

    const [subs] = await pool.query(
        `SELECT s.id, s.endpoint, s.p256dh, s.auth_key
         FROM push_subscriptions s
                  LEFT JOIN users u ON u.id = s.user_id
         WHERE (? = 'all' OR u.role = ?)
           AND (u.id IS NOT NULL AND u.role <> 'pending')`,
        [audience, audience],
    );
    if (subs.length === 0) return { sent: 0, removed: 0 };

    const body = JSON.stringify(payload);
    /** @type {number[]} */
    const dead = [];
    let sent = 0;

    await Promise.all(
        subs.map(async (/** @type {any} */ s) => {
            try {
                await webpush.sendNotification(
                    { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
                    body,
                    { TTL: 60 * 60 }, // 한 시간 안에 못 받으면 버린다. 지난 재고 알림은 쓸모가 없다
                );
                sent++;
            } catch (/** @type {any} */ err) {
                // 404/410은 구독이 사라졌다는 뜻이다(브라우저 재설치, 알림 차단 등). 지운다.
                if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(s.id);
                else console.error('[🔥 푸시 전송 실패]', err?.statusCode, err?.body || err?.message);
            }
        }),
    );

    if (dead.length > 0) {
        await pool.query('DELETE FROM push_subscriptions WHERE id IN (?)', [dead]);
    }
    if (sent > 0) {
        await pool.query('UPDATE push_subscriptions SET last_sent = NOW() WHERE id IN (?)', [
            subs.filter((/** @type {any} */ s) => !dead.includes(s.id)).map((/** @type {any} */ s) => s.id),
        ]);
    }
    return { sent, removed: dead.length };
}

/**
 * 한 사람의 기기들(구독)에만 보낸다. 연결이 끊긴 근무자에게 시각 알림을 전할 때 쓴다(utils/presence.js).
 * @param {string} userId
 * @param {any} payload
 * @returns {Promise<{sent: number, removed: number, skipped?: string}>}
 */
async function sendToUser(userId, payload) {
    if (!isConfigured) return { sent: 0, removed: 0, skipped: 'VAPID 미설정' };
    const [subs] = await pool.query('SELECT id, endpoint, p256dh, auth_key FROM push_subscriptions WHERE user_id = ?', [
        userId,
    ]);
    if (subs.length === 0) return { sent: 0, removed: 0, skipped: '구독 없음' };
    const body = JSON.stringify(payload);
    /** @type {number[]} */
    const dead = [];
    let sent = 0;
    await Promise.all(
        subs.map(async (/** @type {any} */ s) => {
            try {
                await webpush.sendNotification(
                    { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
                    body,
                    { TTL: 60 * 60 },
                );
                sent++;
            } catch (/** @type {any} */ err) {
                if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(s.id);
                else console.error('[🔥 푸시 전송 실패]', err?.statusCode, err?.body || err?.message);
            }
        }),
    );
    if (dead.length > 0) await pool.query('DELETE FROM push_subscriptions WHERE id IN (?)', [dead]);
    return { sent, removed: dead.length };
}

/** 특정 구독 하나에만 보낸다(테스트용). @param {string} endpoint @param {any} payload */
async function sendToEndpoint(endpoint, payload) {
    if (!isConfigured) return { sent: 0, removed: 0, skipped: 'VAPID 미설정' };
    const [[s]] = await pool.query('SELECT id, endpoint, p256dh, auth_key FROM push_subscriptions WHERE endpoint = ?', [
        endpoint,
    ]);
    if (!s) return { sent: 0, removed: 0, skipped: '구독 없음' };
    try {
        await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
            JSON.stringify(payload),
            { TTL: 60 * 60 },
        );
        return { sent: 1, removed: 0 };
    } catch (/** @type {any} */ err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
            await pool.query('DELETE FROM push_subscriptions WHERE id = ?', [s.id]);
            return { sent: 0, removed: 1 };
        }
        throw err;
    }
}

module.exports = { isConfigured, publicKey: PUBLIC_KEY ?? null, sendToAudience, sendToUser, sendToEndpoint };
