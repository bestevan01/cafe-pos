const pool = require('../config/db');

/**
 * 재고 조사 회차.
 *
 * 매장마다 근무 시간이 달라 시각을 코드에 박을 수 없다. 관리자가 정한 값을 DB에서 읽는다.
 *
 * ── 관리자는 '시각'만 정하고, 경계는 여기서 만든다 ──
 * 11시·15시·17시라면 경계는 13시와 16시다(이웃한 두 시각의 가운데). 조사가 조금 늦어도
 * 가운데를 넘지 않으면 원래 회차로 들어간다. 경계를 직접 입력하게 하면 "11시 조사인데 왜
 * 13시까지 11시 회차인가"를 매번 설명해야 한다.
 *
 * ⚠️ 시각 판단은 반드시 DB(+09:00 세션)에게 맡긴다. 배포 서버는 UTC로 돌아서
 * new Date().getHours()를 쓰면 한국 시각과 어긋난다(utils/kstDate.js 참고).
 *
 * slot_key는 'HHMM'이라 문자열 정렬이 곧 시간 순이다. 덕분에 회차가 몇 개든
 * ORDER BY slot 하나로 정렬되고, 코드가 회차 목록을 들고 다닐 필요가 없다.
 */

/** 회차가 하나도 없을 때 쓰는 값. 설정 전에도 조사를 못 하게 막지는 않는다. */
const FALLBACK = { slot_key: '0000', label: '조사', run_at: '00:00:00' };

/** @returns {Promise<{slot_key: string, label: string, run_at: string}[]>} */
async function loadSlots() {
    const [rows] = await pool.query(
        `SELECT slot_key, label, TIME_FORMAT(run_at, '%H:%i') AS run_at
         FROM inventory_slots
         ORDER BY slot_key`,
    );
    return rows.length > 0 ? rows : [FALLBACK];
}

/** 'HH:MM' → 분. 가운데 값을 구하려면 분 단위로 다뤄야 한다(11시·12시30분처럼 섞일 수 있다). */
const toMinutes = (/** @type {string} */ hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
};

const toHHMM = (/** @type {number} */ mins) =>
    `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/**
 * 지금이 어느 회차인지 정하는 SQL 조각.
 *
 * 마지막 회차를 기본값으로 두고 앞 회차부터 감싸 올린다 —
 * IF(TIME(NOW()) < '13:00', '1100', IF(TIME(NOW()) < '16:00', '1500', '1700'))
 * (반대로 감싸면 가장 바깥 조건이 항상 참이라 마지막 회차만 나온다)
 *
 * @param {{slot_key: string, run_at: string}[]} slots
 */
function slotSql(slots) {
    if (slots.length === 1) return `'${slots[0].slot_key}'`;
    let sql = `'${slots[slots.length - 1].slot_key}'`;
    for (let i = slots.length - 2; i >= 0; i--) {
        const boundary = toHHMM(Math.round((toMinutes(slots[i].run_at) + toMinutes(slots[i + 1].run_at)) / 2));
        sql = `IF(TIME(NOW()) < '${boundary}', '${slots[i].slot_key}', ${sql})`;
    }
    return sql;
}

/** 회차 목록과 '지금 어느 회차인지'를 함께 돌려준다. 호출부가 두 번 물어보지 않도록. */
async function currentSlot() {
    const slots = await loadSlots();
    const [[now]] = await pool.query(`SELECT ${slotSql(slots)} AS slot`);
    const found = slots.find((s) => s.slot_key === now.slot) ?? slots[0];
    return { slots, key: found.slot_key, label: found.label };
}

/**
 * '재고 조사 시각 알림'의 시각표를 회차와 같게 맞춘다.
 * 알림 시각을 따로 입력받지 않기 위한 것이다(두 곳에 입력하면 언젠가 어긋난다).
 * 회차를 추가·삭제한 직후와 서버 기동 때 부른다.
 */
async function syncInventoryReminders() {
    // alerts.js는 이 파일을 모르고, 이 파일만 alerts.js를 안다. 순환을 피하려고 여기서 불러온다.
    const { syncSchedules } = require('./alerts');
    const [rows] = await pool.query("SELECT TIME_FORMAT(run_at, '%H:%i') AS t FROM inventory_slots");
    await syncSchedules(
        'inventory_count_reminder',
        rows.map((/** @type {any} */ r) => r.t),
    );
}

module.exports = { loadSlots, slotSql, currentSlot, toMinutes, toHHMM, syncInventoryReminders };
