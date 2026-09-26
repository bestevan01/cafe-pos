/**
 * 근무 중인 사람의 연결 상태. 알림을 '연결이 끊긴 근무자'에게도 전하기 위해 둔다.
 *
 * 시각 알림은 그 순간 연결된 기기에만 한 번 나간다. 휴대폰은 화면이 꺼지면 연결이 끊기므로,
 * 16시에 화면이 꺼져 있던 근무자는 알림을 영영 받지 못했다. 그래서 '근무 중인데 지금 끊긴 사람'을
 * 기억해 두고 alerts.js가 그 사람에게 따로 전한다(푸시 구독이 있으면 푸시, 없으면 다시 붙을 때).
 *
 * '근무 중'의 기준: 모든 연결이 끊긴 지 1시간이 안 됐고, 직접 로그아웃하지 않았다.
 * 1시간은 앱의 무활동 자동 로그아웃과 같은 기준이다(주방 인원 유예와도 같다).
 * 로그아웃한 사람은 곧바로 뺀다 — 퇴근한 사람의 폰을 울리지 않는다.
 *
 * ⚠️ 단일 인스턴스 인메모리다(socketHandlers.js의 캐셔·주방 상태와 같은 판단). 서버가 재시작되면
 *    잊는다 — 그때는 예전처럼 연결된 기기에만 간다.
 */

const AWAY_MS = 60 * 60 * 1000;

/** @typedef {{id: string, username: string, role: string}} PresenceUser */

/** @type {Map<string, Set<string>>} userId → 연결된 소켓 */
const online = new Map();
/** @type {Map<string, number>} socketId → 연결된 시각 */
const connectedAt = new Map();
/**
 * userId → 마지막으로 로그아웃한 시각.
 * 로그아웃 뒤에 옛 소켓의 끊김이 늦게 도착하면(서버가 죽은 연결을 한참 뒤에 알아챈다)
 * 그 사람을 다시 '끊긴 근무자'로 올리게 된다. 로그아웃보다 먼저 붙었던 소켓의 끊김은 무시한다.
 * @type {Map<string, number>}
 */
const loggedOutAt = new Map();
/** @type {Map<string, PresenceUser & {since: number}>} userId → 끊긴 근무자 */
const away = new Map();
/**
 * 다시 붙으면 전할 알림. 내용은 저장하지 않고 '무엇을 언제까지'만 둔다 —
 * 전하는 순간 다시 만들어 봐야 이미 끝난 일(회차를 냈다 등)을 알리지 않는다.
 * @type {Map<string, {key: string, runAt?: string, expiresAt: number}[]>}
 */
const pending = new Map();

function prune() {
    const now = Date.now();
    for (const [id, u] of away) {
        if (now - u.since >= AWAY_MS) {
            away.delete(id);
            pending.delete(id);
        }
    }
    for (const [id, list] of pending) {
        const alive = list.filter((p) => p.expiresAt > now);
        if (alive.length === 0) pending.delete(id);
        else pending.set(id, alive);
    }
}

/** @param {PresenceUser} user @param {string} socketId */
function connected(user, socketId) {
    const set = online.get(user.id) ?? new Set();
    set.add(socketId);
    online.set(user.id, set);
    connectedAt.set(socketId, Date.now());
    away.delete(user.id);
}

/** @param {PresenceUser} user @param {string} socketId */
function disconnected(user, socketId) {
    const since = connectedAt.get(socketId) ?? 0;
    connectedAt.delete(socketId);
    const set = online.get(user.id);
    if (!set) return;
    set.delete(socketId);
    if ((loggedOutAt.get(user.id) ?? 0) >= since) {
        // 이 소켓이 붙은 뒤에 로그아웃했다. 끊긴 근무자가 아니라 퇴근한 사람이다.
        if (set.size === 0) online.delete(user.id);
        return;
    }
    if (set.size > 0) return; // 다른 기기가 아직 붙어 있다
    online.delete(user.id);
    away.set(user.id, { id: user.id, username: user.username, role: user.role, since: Date.now() });
}

/** 직접 로그아웃했다. 끊긴 근무자로도, 받을 알림도 남기지 않는다. @param {string} userId */
function loggedOut(userId) {
    loggedOutAt.set(userId, Date.now());
    away.delete(userId);
    pending.delete(userId);
}

/**
 * 받을 대상 중 지금 끊겨 있는 근무자.
 * @param {'admin'|'staff'|'all'} audience
 * @returns {(PresenceUser & {since: number})[]}
 */
function awayUsers(audience) {
    prune();
    return [...away.values()].filter((u) => audience === 'all' || u.role === audience);
}

/** @param {string} userId @param {{key: string, runAt?: string, expiresAt: number}} entry */
function queue(userId, entry) {
    const list = (pending.get(userId) ?? []).filter((p) => !(p.key === entry.key && p.runAt === entry.runAt));
    list.push(entry);
    pending.set(userId, list);
}

/** 다시 붙은 사람에게 전할 알림을 꺼낸다(꺼내면 지운다). @param {string} userId */
function takePending(userId) {
    prune();
    const list = pending.get(userId) ?? [];
    pending.delete(userId);
    return list;
}

module.exports = { connected, disconnected, loggedOut, awayUsers, queue, takePending, AWAY_MS };
