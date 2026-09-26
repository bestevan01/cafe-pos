const express = require('express');
const pool = require('../config/db');
const debugInfo = require('./debugInfo');

/**
 * 하루 여러 번 하는 일의 '회차'. 재고 조사와 위생 점검이 함께 쓴다.
 *
 * 매장마다 근무 시간이 달라 시각을 코드에 박을 수 없다. 코드는 매장끼리 공유하므로 기본 시각도
 * 두지 않는다 — 관리자가 매장에 맞게 넣고, 비어 있는 동안에는 기능마다 정한 fallback을 쓴다.
 *
 * ── 관리자는 '시각'만 정하고, 경계는 여기서 만든다 ──
 * 11시·15시·17시라면 경계는 13시와 16시다(이웃한 두 시각의 가운데). 조금 늦어도 가운데를
 * 넘지 않으면 원래 회차로 들어간다. 경계를 직접 입력하게 하면 "11시 조사인데 왜 13시까지
 * 11시 회차인가"를 매번 설명해야 한다.
 *
 * ── 회차마다 요일을 고른다 ──
 * 요일마다 운영 시간이 다르다(예: 월~수 17시 마감, 목 16시 마감, 금 미운영). 회차 목록이 하나면
 * 목요일 마감 조사(15시 반쯤)가 15시 회차로 들어가 이미 낸 기록을 덮어쓴다. 그래서 회차마다
 * 적용 요일을 두고, 경계는 '그날 적용되는 회차끼리'만 계산한다.
 * 그날 적용되는 회차가 하나도 없으면 미운영일이다 — 알림을 보내지 않는다.
 *
 * days는 ISO 요일 숫자를 이어 붙인 문자열이다('1'=월 … '7'=일). 예: 월~목 = '1234'.
 *
 * ⚠️ 시각·요일 판단은 반드시 DB(+09:00 세션)에게 맡긴다. 배포 서버는 UTC로 돌아서
 * new Date().getHours()나 getDay()를 쓰면 한국 시각과 어긋난다(utils/kstDate.js 참고).
 *
 * slot_key는 'HHMM'이라 문자열 정렬이 곧 시간 순이다.
 */

/** @typedef {{slot_key: string, label: string, run_at: string, days?: string}} Slot */

const ALL_DAYS = '1234567';
const DAY_NAMES = ['월', '화', '수', '목', '금', '토', '일'];

/** 'HH:MM' → 분. 가운데 값을 구하려면 분 단위로 다뤄야 한다(11시·12시30분처럼 섞일 수 있다). */
const toMinutes = (/** @type {string} */ hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
};

const toHHMM = (/** @type {number} */ mins) =>
    `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/** 두 회차 사이의 경계. */
const boundary = (/** @type {Slot} */ a, /** @type {Slot} */ b) =>
    toHHMM(Math.round((toMinutes(a.run_at) + toMinutes(b.run_at)) / 2));

/**
 * 요일 입력을 정리한다. 숫자 배열이나 문자열을 받아 '1'~'7'만 남기고 정렬한다.
 * @param {any} v
 * @returns {string|null} 하나도 없으면 null
 */
function normalizeDays(v) {
    const raw = Array.isArray(v) ? v.join('') : String(v ?? '');
    const set = new Set([...raw].filter((c) => c >= '1' && c <= '7'));
    const out = [...set].sort().join('');
    return out || null;
}

/** '1234' → '월~목', '1235' → '월~수 · 금', '1234567' → '매일' */
function daysText(/** @type {string} */ days) {
    if (!days || days === ALL_DAYS) return '매일';
    const nums = [...days].map(Number);
    /** @type {string[]} */
    const parts = [];
    for (let i = 0; i < nums.length;) {
        let j = i;
        while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
        const a = DAY_NAMES[nums[i] - 1];
        const b = DAY_NAMES[nums[j] - 1];
        parts.push(j - i >= 2 ? `${a}~${b}` : j === i ? a : `${a} · ${b}`);
        i = j + 1;
    }
    return parts.join(' · ');
}

/**
 * 지금이 어느 회차인지 정하는 SQL 조각.
 *
 * 마지막 회차를 기본값으로 두고 앞 회차부터 감싸 올린다 —
 * IF(TIME(NOW()) < '13:00', '1100', IF(TIME(NOW()) < '16:00', '1500', '1700'))
 * (반대로 감싸면 가장 바깥 조건이 항상 참이라 마지막 회차만 나온다)
 *
 * 키와 시각은 이 모듈이 검증해 넣은 값(HHMM)이거나 코드에 적힌 fallback이지만 escape해서 넣는다.
 * 넘기는 목록은 '그날 적용되는 회차'여야 한다(요일이 다른 회차가 섞이면 경계가 틀어진다).
 *
 * @param {Slot[]} slots
 */
function slotSql(slots) {
    if (slots.length === 1) return pool.escape(slots[0].slot_key);
    let sql = pool.escape(slots[slots.length - 1].slot_key);
    for (let i = slots.length - 2; i >= 0; i--) {
        sql = `IF(TIME(NOW()) < ${pool.escape(boundary(slots[i], slots[i + 1]))}, ${pool.escape(slots[i].slot_key)}, ${sql})`;
    }
    return sql;
}

/** 시각에서 기본 이름을 만든다. '15:00' → '오후 3시', '09:30' → '오전 9시 30분' */
function defaultLabel(/** @type {string} */ runAt) {
    const [h, m] = runAt.split(':').map(Number);
    const half = h < 12 ? '오전' : '오후';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${half} ${hour12}시${m ? ` ${m}분` : ''}`;
}

/** 'HH:MM'만 통과시킨다. */
const asTime = (/** @type {any} */ v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v ?? '')) ? String(v) : null);

/**
 * 관리자 화면에 보여줄 '이 회차로 기록되는 시간대'. 요일마다 함께 도는 회차가 달라 범위도 다를 수 있어
 * 요일별로 계산한 뒤 같은 범위끼리 묶는다. 예: [{days:'123', from:'13:00', until:'16:00'}, {days:'4', ...}]
 * @param {Slot & {days: string}} slot
 * @param {(Slot & {days: string})[]} all
 */
function rangesOf(slot, all) {
    /** @type {Map<string, string>} 범위 → 요일들 */
    const byRange = new Map();
    for (const d of slot.days) {
        const sameDay = all.filter((s) => s.days.includes(d));
        const i = sameDay.findIndex((s) => s.slot_key === slot.slot_key);
        const from = sameDay[i - 1] ? boundary(sameDay[i - 1], slot) : '00:00';
        const until = sameDay[i + 1] ? boundary(slot, sameDay[i + 1]) : '24:00';
        const key = `${from}~${until}`;
        byRange.set(key, (byRange.get(key) ?? '') + d);
    }
    return [...byRange.entries()].map(([range, days]) => {
        const [from, until] = range.split('~');
        return { days, days_text: daysText(days), from, until };
    });
}

/**
 * @param {object} opts
 * @param {string} opts.table     회차 표 이름(코드에 적힌 상수만 넘긴다)
 * @param {string} opts.alertKey  회차 시각을 따라가는 알림(utils/alerts.js의 managed 알림)
 * @param {string} opts.what      에러 로그·안내에 쓸 이름. 예: '재고 조사'
 * @param {Slot[]} opts.fallback  회차가 하나도 없을 때 쓰는 목록. 설정 전에도 기능을 막지 않는다.
 * @param {() => Promise<void>} [opts.onChange]  회차가 바뀐 직후 부른다(위생 점검의 회차 이력 등)
 */
function createSlotSchedule({ table, alertKey, what, fallback, onChange }) {
    /**
     * 관리자가 넣은 회차 전부(요일 무관). 비어 있을 수 있다.
     * @returns {Promise<(Slot & {days: string})[]>}
     */
    async function listSlots() {
        const [rows] = await pool.query(
            `SELECT slot_key, label, TIME_FORMAT(run_at, '%H:%i') AS run_at, days FROM ${table} ORDER BY slot_key`,
        );
        return rows;
    }

    /**
     * 오늘(한국 날짜) 적용되는 회차만. 요일은 DB가 정한다.
     * @returns {Promise<(Slot & {days: string})[]>}
     */
    async function todaySlots() {
        const [rows] = await pool.query(
            `SELECT slot_key, label, TIME_FORMAT(run_at, '%H:%i') AS run_at, days
             FROM ${table}
             WHERE LOCATE(WEEKDAY(CURDATE()) + 1, days) > 0
             ORDER BY slot_key`,
        );
        return rows;
    }

    /**
     * 실제로 쓸 회차.
     *  - 아직 하나도 안 넣었으면 fallback(기능마다 예전 방식)
     *  - 오늘 적용되는 회차가 있으면 그것
     *  - 넣었는데 오늘은 없으면(미운영일) 전체 회차로 받는다. 누가 나와서 기록하는 것까지 막지는 않는다.
     * @returns {Promise<{slots: Slot[], offDay: boolean, configured: boolean}>}
     */
    async function resolveSlots() {
        const today = await todaySlots();
        if (today.length > 0) return { slots: today, offDay: false, configured: true };
        const all = await listSlots();
        if (all.length === 0) return { slots: fallback, offDay: false, configured: false };
        return { slots: all, offDay: true, configured: true };
    }

    /** @returns {Promise<Slot[]>} */
    async function loadSlots() {
        return (await resolveSlots()).slots;
    }

    /** 회차 목록과 '지금 어느 회차인지'를 함께 돌려준다. 호출부가 두 번 물어보지 않도록. */
    async function currentSlot() {
        const { slots, offDay, configured } = await resolveSlots();
        const [[now]] = await pool.query(`SELECT ${slotSql(slots)} AS slot`);
        const found = slots.find((s) => s.slot_key === now.slot) ?? slots[0];
        return { slots, key: found.slot_key, label: found.label, offDay, configured };
    }

    /**
     * 회차를 따라가는 알림의 시각표를 회차와 같게 맞춘다.
     * 알림 시각을 따로 입력받지 않기 위한 것이다(두 곳에 입력하면 언젠가 어긋난다).
     * 회차를 추가·삭제한 직후와 서버 기동 때 부른다. fallback은 시각이 없는 것으로 본다.
     * 요일은 여기서 거르지 않는다 — 알림을 만들 때 오늘 회차인지 확인한다(todaySlots).
     */
    async function syncReminders() {
        // alerts.js는 이 파일을 모르고, 이 파일만 alerts.js를 안다. 순환을 피하려고 여기서 불러온다.
        const { syncSchedules } = require('./alerts');
        const rows = await listSlots();
        await syncSchedules(
            alertKey,
            rows.map((r) => r.run_at),
        );
    }

    async function changed() {
        await syncReminders();
        if (onChange) await onChange();
    }

    /**
     * 관리자용 회차 API. 인증·권한은 마운트하는 쪽 라우터가 이미 걸었다.
     *   GET    /        회차 목록(요일별 시간대 포함)
     *   POST   /        { run_at: 'HH:MM', label?, days? }  days를 안 주면 매일
     *   PATCH  /:id     { days }
     *   DELETE /:id
     */
    const router = express.Router();

    router.get('/', async (req, res) => {
        try {
            const [rows] = await pool.query(
                `SELECT id, slot_key, label, TIME_FORMAT(run_at, '%H:%i') AS run_at, days
                 FROM ${table} ORDER BY slot_key`,
            );
            // 요일별 시간대를 함께 내려 화면이 '몇 시까지 이 회차인지'를 보여줄 수 있게 한다.
            res.json(
                rows.map((/** @type {any} */ r) => ({
                    ...r,
                    days_text: daysText(r.days),
                    ranges: rangesOf(r, rows),
                })),
            );
        } catch (/** @type {any} */ err) {
            console.error(`[🔥 GET ${what} 회차 에러]`, err);
            res.status(500).json({
                success: false,
                message: '회차를 불러오지 못했습니다.',
                debug_info: debugInfo(err),
            });
        }
    });

    router.post('/', async (req, res) => {
        const runAt = asTime(req.body.run_at);
        if (!runAt) return res.status(400).json({ success: false, message: '시각을 HH:MM으로 입력해주세요.' });
        const days = req.body.days === undefined ? ALL_DAYS : normalizeDays(req.body.days);
        if (!days) return res.status(400).json({ success: false, message: '요일을 하나 이상 골라주세요.' });
        const label =
            String(req.body.label ?? '')
                .trim()
                .slice(0, 20) || defaultLabel(runAt);
        const key = runAt.replace(':', '');
        try {
            await pool.query(
                `INSERT INTO ${table} (slot_key, label, run_at, days, sort_order) VALUES (?, ?, ?, ?, ?)`,
                [key, label, runAt, days, Number(key)],
            );
            await changed();
            res.json({ success: true, slot_key: key });
        } catch (/** @type {any} */ err) {
            if (err && err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({
                    success: false,
                    message: '이미 같은 시각의 회차가 있습니다. 그 회차의 요일을 고쳐주세요.',
                });
            }
            console.error(`[🔥 POST ${what} 회차 에러]`, err);
            res.status(500).json({
                success: false,
                message: '회차를 추가하지 못했습니다.',
                debug_info: debugInfo(err),
            });
        }
    });

    router.patch('/:id', async (req, res) => {
        const days = normalizeDays(req.body.days);
        if (!days) return res.status(400).json({ success: false, message: '요일을 하나 이상 골라주세요.' });
        try {
            const [r] = await pool.query(`UPDATE ${table} SET days = ? WHERE id = ?`, [days, req.params.id]);
            if (r.affectedRows === 0) {
                return res.status(404).json({ success: false, message: '회차를 찾을 수 없습니다.' });
            }
            await changed();
            res.json({ success: true });
        } catch (/** @type {any} */ err) {
            console.error(`[🔥 PATCH ${what} 회차 에러]`, err);
            res.status(500).json({ success: false, message: '요일을 바꾸지 못했습니다.', debug_info: debugInfo(err) });
        }
    });

    router.delete('/:id', async (req, res) => {
        try {
            // 지난 기록은 회차 이름을 스냅샷으로 갖고 있어 회차를 지워도 그대로 보인다.
            // 마지막 하나는 지우지 못하게 한다 — 비면 fallback으로 돌아가 기록 방식이 갑자기 바뀐다.
            const [[left]] = await pool.query(`SELECT COUNT(*) AS n FROM ${table}`);
            if (left.n <= 1) {
                return res.status(409).json({ success: false, message: '회차는 최소 하나는 있어야 합니다.' });
            }
            await pool.query(`DELETE FROM ${table} WHERE id = ?`, [req.params.id]);
            await changed();
            res.json({ success: true });
        } catch (/** @type {any} */ err) {
            console.error(`[🔥 DELETE ${what} 회차 에러]`, err);
            res.status(500).json({ success: false, message: '회차를 지우지 못했습니다.', debug_info: debugInfo(err) });
        }
    });

    return { listSlots, todaySlots, loadSlots, currentSlot, syncReminders, router };
}

module.exports = { createSlotSchedule, slotSql, toMinutes, toHHMM, defaultLabel, daysText, ALL_DAYS };
