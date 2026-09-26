const pool = require('../config/db');
const { createSlotSchedule } = require('./slotSchedule');

/**
 * 위생 점검 회차. 공통 동작은 utils/slotSchedule.js에 있다(재고 조사와 함께 쓴다).
 *
 * 매장마다 점검 시각이 다르다(운영 지침으로 매장별로 정해진다). 코드는 매장끼리 공유하므로
 * 시각을 박지 않고 관리자가 넣는다.
 *
 * ── 회차를 넣기 전: 예전 방식 그대로 ──
 * 오전(am)·오후(pm) 두 칸을 정오로 나눈다. 두 칸의 run_at은 경계를 정오로 만들기 위한
 * 값일 뿐(6시·18시의 가운데 = 12시) 실제 점검 시각이 아니다. 알림도 보내지 않는다.
 * 이 두 키는 지난 기록(hygiene_checks.slot)에 그대로 남아 있어 바꾸면 안 된다.
 *
 * ── 소급하지 않는다 ──
 * 회차를 바꾸면 그날부터의 회차 목록을 hygiene_slot_plans에 남긴다. 보고서는 날짜마다
 * 그날 유효했던 목록으로 '해야 했던 회차'를 그린다. 지금 설정으로 과거를 그리면, 회차를
 * 바꾼 순간 지난 몇 달이 전부 '기록 없음'투성이가 된다.
 * 기록 자체도 회차 이름을 복사해 둔다(slot_label) — 회차를 지우거나 이름을 바꿔도 그대로다.
 */
const LEGACY_PLAN = [
    { slot_key: 'am', label: '오전', run_at: '06:00' },
    { slot_key: 'pm', label: '오후', run_at: '18:00' },
];

/** 지금 설정을 오늘부터의 회차 목록으로 남긴다. 같은 날 여러 번 바꾸면 마지막 것만 남는다. */
async function recordPlan() {
    const slots = await hygieneSlots.listSlots();
    await pool.query(
        `INSERT INTO hygiene_slot_plans (effective_date, slots)
         VALUES (CURDATE(), ?)
         ON DUPLICATE KEY UPDATE slots = VALUES(slots)`,
        // 요일도 함께 남긴다. 보고서가 그날 요일에 해야 했던 회차만 그리고, 회차가 없는 요일은 미운영일로 본다.
        [JSON.stringify(slots.map((s) => ({ slot_key: s.slot_key, label: s.label, days: s.days })))],
    );
}

const hygieneSlots = createSlotSchedule({
    table: 'hygiene_slots',
    alertKey: 'hygiene_check_reminder',
    what: '위생 점검',
    fallback: LEGACY_PLAN,
    onChange: recordPlan,
});

/**
 * 보고서 구간에 필요한 회차 이력. 구간 시작 전의 마지막 한 건도 함께 준다(구간 첫날에 유효한 목록).
 * @param {string} from 'YYYY-MM-DD'
 * @param {string} to   'YYYY-MM-DD'
 * @returns {Promise<{effective_date: string, slots: {slot_key: string, label: string, days?: string}[]}[]>}
 */
async function loadPlans(from, to) {
    const [rows] = await pool.query(
        `SELECT DATE_FORMAT(effective_date, '%Y-%m-%d') AS effective_date, slots
         FROM hygiene_slot_plans
         WHERE effective_date <= ?
           AND effective_date >= COALESCE(
                 (SELECT MAX(effective_date) FROM hygiene_slot_plans WHERE effective_date <= ?), ?)
         ORDER BY effective_date`,
        [to, from, from],
    );
    return rows.map((/** @type {any} */ r) => ({
        effective_date: r.effective_date,
        slots: (() => {
            try {
                return typeof r.slots === 'string' ? JSON.parse(r.slots) : r.slots;
            } catch {
                return [];
            }
        })(),
    }));
}

module.exports = {
    hygieneSlots,
    loadPlans,
    LEGACY_PLAN: LEGACY_PLAN.map(({ slot_key, label }) => ({ slot_key, label })),
};
