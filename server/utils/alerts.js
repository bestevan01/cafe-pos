const pool = require('../config/db');
const push = require('../config/push');

/**
 * 정해진 시각에 브라우저 알림을 띄우는 공통 장치.
 *
 * 기능마다 따로 만들면 시각 계산·중복 방지·권한 대상 고르기를 매번 다시 짜게 된다.
 * 여기서는 '언제 울릴지'만 맡고, '무엇을 알릴지'는 기능이 registerAlert로 등록한다.
 *
 * 쓰는 법:
 *   registerAlert('inventory_low', {
 *       label: '재고 주문 필요',
 *       audience: 'admin',
 *       build: async () => ({ title: '...', body: '...' }) 또는 null(알릴 것 없음),
 *   });
 *
 * 두 갈래로 보낸다.
 *  - 소켓: 앱 탭이 열려 있는 사람에게 곧바로
 *  - 웹 푸시: 탭을 닫아둔 사람에게도(서비스 워커가 브라우저 백그라운드에서 받는다)
 *
 * 둘 다 받는 사람은 알림이 두 번 뜰 것 같지만, 양쪽이 같은 tag를 쓰므로 브라우저가
 * 하나로 합친다(뒤엣것이 앞엣것을 덮어쓴다).
 *
 * 그래도 화면에서 같은 내용을 볼 수 있게 만들어 두는 것이 원칙이다 — 알림은 권한·기기·
 * 브라우저 사정으로 언제든 안 올 수 있고, 그때 판단 근거가 사라지면 안 된다.
 */

/**
 * @typedef {object} AlertDef
 * @property {string} label 화면에 보일 이름
 * @property {string} [description] 받는 사람에게 보여줄 한 줄 설명. 받는 쪽 화면이 이 값을 그대로 쓴다
 *           (문구를 화면에 박아 두면 알림을 끄거나 바꿔도 화면이 옛 설명을 계속 보여준다)
 * @property {'admin'|'staff'|'all'} audience 누구에게 보낼지
 * @property {(ctx: {runAt?: string}) => Promise<{title: string, body: string, action?: string}|null>} build
 *           알릴 내용. null이면 이번엔 거른다. runAt은 이 알림을 부른 예정 시각('HH:MM')
 * @property {string} [action] 알림을 눌렀을 때 앱이 할 일의 이름. 예: 'open_inventory_count'.
 *           이 앱은 주소(URL)가 아니라 화면 상태로 이동하므로, 주소 대신 이름을 보낸다.
 *           이름과 실제 동작의 연결은 클라이언트(browserNotify의 registerAlertAction)가 한다.
 *           build가 action을 돌려주면 그쪽이 우선한다(상황에 따라 다른 화면으로 보낼 때).
 * @property {('socket'|'push')[]} [channels] 보낼 통로. 기본은 둘 다.
 *           '지금 접속한 사람에게만' 가야 하는 알림은 socket만 쓴다 — 푸시는 탭을 닫은 사람의
 *           개인 폰까지 울리므로, 쉬는 날 근무자에게 업무 알림이 가는 일이 생긴다.
 * @property {number} [graceMinutes] 예정 시각을 얼마나 넘겨도 보낼지. 기본 120분.
 *           '지금 하세요' 류의 알림은 늦게 가면 쓸모가 없으니 짧게 둔다.
 * @property {boolean} [managed] 시각을 사람이 아니라 코드가 맞춘다(syncSchedules).
 *           관리자 화면에서 시각을 직접 추가하지 못하게 막는 표시다.
 */

/** @type {Map<string, AlertDef>} */
const registry = new Map();

/**
 * 알림 key → 마지막으로 보낸 내용의 표식.
 *
 * 같은 내용을 반복해 보내지 않기 위한 것이다. 재고 조사는 제출 후에도 숫자를 고칠 수 있는데,
 * 고칠 때마다 알림이 가면 사람은 곧 무시하게 된다. 내용이 실제로 달라졌을 때만 울린다.
 *
 * 인메모리인 이유: 서버가 재시작되면 한 번 더 울릴 수 있지만, 그 정도는 문제가 되지 않는다.
 * 반대로 DB에 두면 알림 하나 보낼 때마다 쓰기가 생긴다.
 * @type {Map<string, string>}
 */
const lastSignature = new Map();

/**
 * 서버가 잠들었다 깨거나 재시작해서 시각을 놓쳤을 때, 얼마나 늦게까지 보낼지.
 * 무제한으로 두면 아침 9시 알림이 밤 11시에 뜬다. 그때는 이미 쓸모가 없다.
 */
const GRACE_MINUTES = 120;
const TICK_MS = 60 * 1000;

/** @param {string} key @param {AlertDef} def */
function registerAlert(key, def) {
    registry.set(key, def);
}

/** 관리자 화면이 고를 수 있는 알림 목록. */
function listAlertTypes() {
    return [...registry.entries()].map(([key, def]) => ({
        key,
        label: def.label,
        description: def.description ?? '',
        audience: def.audience,
        managed: Boolean(def.managed),
    }));
}

/**
 * 코드가 시각을 맞추는 알림(managed)의 시각표를 원하는 목록과 같게 만든다.
 *
 * 재고 조사 알림처럼 '다른 설정의 시각을 그대로 따라가는' 알림이 있다. 시각을 두 곳에
 * 입력하게 하면 언젠가 어긋나므로, 원래 설정이 바뀔 때마다 여기로 옮겨 적는다.
 *  - 없던 시각은 추가한다(오늘이 이미 지났으면 오늘은 보낸 것으로). 켜짐 여부는 기존 시각을 따른다 —
 *    관리자가 알림을 꺼 둔 뒤 회차를 추가했는데 새 시각만 켜져 다시 울리면 안 된다. 처음이면 켜진 채로.
 *  - 사라진 시각은 지운다
 *  - 남아 있는 시각은 건드리지 않는다 — 관리자가 꺼 둔 것을 다시 켜버리면 안 된다
 *
 * @param {string} key
 * @param {string[]} times 'HH:MM' 목록
 */
async function syncSchedules(key, times) {
    const want = new Set(times);
    const [rows] = await pool.query(
        "SELECT id, TIME_FORMAT(run_at, '%H:%i') AS t, is_enabled FROM alert_schedules WHERE alert_key = ?",
        [key],
    );
    const have = new Set(rows.map((/** @type {any} */ r) => r.t));
    const enabled = rows.length === 0 || rows.some((/** @type {any} */ r) => r.is_enabled) ? 1 : 0;

    const gone = rows.filter((/** @type {any} */ r) => !want.has(r.t)).map((/** @type {any} */ r) => r.id);
    if (gone.length > 0) await pool.query('DELETE FROM alert_schedules WHERE id IN (?)', [gone]);

    for (const t of want) {
        if (have.has(t)) continue;
        // 이미 지난 시각이면 오늘치는 보낸 것으로 둔다. 회차를 추가하자마자 알림이 울리면 곤란하다.
        await pool.query(
            `INSERT INTO alert_schedules (alert_key, run_at, is_enabled, last_fired_date)
             VALUES (?, ?, ?, IF(? <= CURTIME(), CURDATE(), NULL))`,
            [key, t, enabled, t],
        );
    }
}

/**
 * 지금 보낼 때가 된 알림을 찾는다.
 *
 * 시각 비교는 전부 DB에게 맡긴다 — 배포 서버는 UTC로 돌아서 JS로 비교하면 9시간 어긋난다.
 * last_fired_date로 하루 한 번만 나가게 막는다(스케줄러는 1분마다 돈다).
 */
async function findDue() {
    const [rows] = await pool.query(
        `SELECT id, alert_key, TIME_FORMAT(run_at, '%H:%i') AS run_at,
                TIMESTAMPDIFF(MINUTE, TIMESTAMP(CURDATE(), run_at), NOW()) AS late
         FROM alert_schedules
         WHERE is_enabled = 1
           AND run_at <= CURTIME()
           AND TIMESTAMPDIFF(MINUTE, TIMESTAMP(CURDATE(), run_at), NOW()) <= ?
           AND (last_fired_date IS NULL OR last_fired_date < CURDATE())
         ORDER BY run_at`,
        [GRACE_MINUTES],
    );
    // 알림마다 유예가 다를 수 있다('지금 하세요' 류는 짧다). 기본 유예 안에서 한 번 더 거른다.
    return rows.map((/** @type {any} */ r) => ({
        ...r,
        tooLate: Number(r.late) > (registry.get(r.alert_key)?.graceMinutes ?? GRACE_MINUTES),
    }));
}

/**
 * 알림 하나를 만들어 보낸다.
 * @param {import('socket.io').Server} io
 * @param {string} key
 * @param {{scheduleId?: number, runAt?: string, socketId?: string, endpoint?: string, dedupeKey?: string}} [opts]
 *        socketId/endpoint를 주면 그 사람에게만 보낸다(테스트용).
 *        dedupeKey를 주면 직전에 보낸 것과 같을 때 건너뛴다.
 * @returns {Promise<{sent: boolean, reason?: string, payload?: any, push?: {sent: number, removed: number, skipped?: string}}>}
 *          push는 웹 푸시로 몇 건 나갔는지(탭이 닫힌 사람 몫). 소켓 몫은 따로 세지 않는다.
 */
async function fireAlert(io, key, opts = {}) {
    const def = registry.get(key);
    if (!def) return { sent: false, reason: '등록되지 않은 알림입니다.' };

    if (opts.dedupeKey && lastSignature.get(key) === opts.dedupeKey) {
        return { sent: false, reason: '직전과 같은 내용이라 건너뜁니다.' };
    }

    const built = await def.build({ runAt: opts.runAt });
    if (!built) return { sent: false, reason: '알릴 내용이 없습니다.' };
    if (opts.dedupeKey) lastSignature.set(key, opts.dedupeKey);

    const payload = {
        key,
        title: built.title,
        body: built.body,
        action: built.action ?? def.action ?? null,
        at: Date.now(),
    };

    const channels = def.channels ?? ['socket', 'push'];

    // (1) 탭이 열려 있는 사람에게 소켓으로
    if (opts.socketId) {
        io.to(opts.socketId).emit('app_alert', payload);
    } else if (def.audience === 'all') {
        io.emit('app_alert', payload);
    } else {
        // 핸드셰이크에서 역할별 방에 넣어둔다(socketHandlers.js).
        io.to(`role:${def.audience}`).emit('app_alert', payload);
    }

    // (2) 탭을 닫아둔 사람에게 웹 푸시로. 실패해도 소켓 쪽은 이미 나갔으므로 삼킨다.
    // '지금 접속한 사람에게만' 가야 하는 알림은 푸시를 쓰지 않는다(channels).
    let pushed = { sent: 0, removed: 0 };
    if (channels.includes('push') || opts.endpoint) {
        try {
            pushed = opts.endpoint
                ? await push.sendToEndpoint(opts.endpoint, payload)
                : await push.sendToAudience(def.audience, payload);
        } catch (/** @type {any} */ err) {
            console.error('[🔥 푸시 발송 오류]', err.message);
        }
    }
    return { sent: true, payload, push: pushed };
}

/**
 * 1분마다 돌며 때가 된 알림을 내보낸다.
 * 알릴 내용이 없어도(build가 null) '오늘은 처리함'으로 표시한다 — 안 그러면 그 시각 이후
 * 매 분 다시 물어보게 된다.
 * @param {import('socket.io').Server} io
 */
function startAlertScheduler(io) {
    const tick = async () => {
        try {
            for (const row of await findDue()) {
                if (row.tooLate) {
                    // 이 알림에게는 이미 늦었다. 보내지 않되, 매 분 다시 묻지 않도록 오늘 처리로 둔다.
                    await pool.query('UPDATE alert_schedules SET last_fired_date = CURDATE() WHERE id = ?', [row.id]);
                    continue;
                }
                const result = await fireAlert(io, row.alert_key, { scheduleId: row.id, runAt: row.run_at });
                await pool.query('UPDATE alert_schedules SET last_fired_date = CURDATE() WHERE id = ?', [row.id]);
                if (result.sent) {
                    const p = result.push;
                    console.log(
                        `[🔔 알림 발송] ${row.alert_key} (${row.run_at}) — ${result.payload.title}` +
                            ` · 푸시 ${p?.sent ?? 0}건${p?.removed ? ` (만료 ${p.removed}건 정리)` : ''}`,
                    );
                }
            }
        } catch (/** @type {any} */ err) {
            // 한 번 실패해도 스케줄러 자체는 계속 돌아야 한다.
            console.error('[🔥 알림 스케줄러 오류]', err.message);
        }
    };
    void tick(); // 기동 직후 한 번 — 껐다 켜는 사이에 지나간 시각을 유예 안에서 챙긴다
    setInterval(tick, TICK_MS).unref();
}

module.exports = { registerAlert, listAlertTypes, fireAlert, syncSchedules, startAlertScheduler, GRACE_MINUTES };
