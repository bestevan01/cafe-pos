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
 * ⚠️ 시각 판단은 반드시 DB(+09:00 세션)에게 맡긴다. 배포 서버는 UTC로 돌아서
 * new Date().getHours()를 쓰면 한국 시각과 어긋난다(utils/kstDate.js 참고).
 *
 * slot_key는 'HHMM'이라 문자열 정렬이 곧 시간 순이다.
 */

/** @typedef {{slot_key: string, label: string, run_at: string}} Slot */

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
 * 지금이 어느 회차인지 정하는 SQL 조각.
 *
 * 마지막 회차를 기본값으로 두고 앞 회차부터 감싸 올린다 —
 * IF(TIME(NOW()) < '13:00', '1100', IF(TIME(NOW()) < '16:00', '1500', '1700'))
 * (반대로 감싸면 가장 바깥 조건이 항상 참이라 마지막 회차만 나온다)
 *
 * 키와 시각은 이 모듈이 검증해 넣은 값(HHMM)이거나 코드에 적힌 fallback이라 문장에 바로 넣는다.
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
 * @param {object} opts
 * @param {string} opts.table     회차 표 이름(코드에 적힌 상수만 넘긴다)
 * @param {string} opts.alertKey  회차 시각을 따라가는 알림(utils/alerts.js의 managed 알림)
 * @param {string} opts.what      에러 로그·안내에 쓸 이름. 예: '재고 조사'
 * @param {Slot[]} opts.fallback  회차가 하나도 없을 때 쓰는 목록. 설정 전에도 기능을 막지 않는다.
 * @param {() => Promise<void>} [opts.onChange]  회차가 바뀐 직후 부른다(위생 점검의 회차 이력 등)
 */
function createSlotSchedule({ table, alertKey, what, fallback, onChange }) {
    /**
     * 관리자가 넣은 회차만. 비어 있을 수 있다.
     * @returns {Promise<Slot[]>}
     */
    async function listSlots() {
        const [rows] = await pool.query(
            `SELECT slot_key, label, TIME_FORMAT(run_at, '%H:%i') AS run_at FROM ${table} ORDER BY slot_key`,
        );
        return rows;
    }

    /**
     * 실제로 쓸 회차. 비어 있으면 fallback.
     * @returns {Promise<Slot[]>}
     */
    async function loadSlots() {
        const rows = await listSlots();
        return rows.length > 0 ? rows : fallback;
    }

    /** 회차 목록과 '지금 어느 회차인지'를 함께 돌려준다. 호출부가 두 번 물어보지 않도록. */
    async function currentSlot() {
        const slots = await loadSlots();
        const [[now]] = await pool.query(`SELECT ${slotSql(slots)} AS slot`);
        const found = slots.find((s) => s.slot_key === now.slot) ?? slots[0];
        return { slots, key: found.slot_key, label: found.label };
    }

    /**
     * 회차를 따라가는 알림의 시각표를 회차와 같게 맞춘다.
     * 알림 시각을 따로 입력받지 않기 위한 것이다(두 곳에 입력하면 언젠가 어긋난다).
     * 회차를 추가·삭제한 직후와 서버 기동 때 부른다. fallback은 시각이 없는 것으로 본다.
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
     *   GET    /        회차 목록(경계 포함)
     *   POST   /        { run_at: 'HH:MM', label? }
     *   DELETE /:id
     */
    const router = express.Router();

    router.get('/', async (req, res) => {
        try {
            const [rows] = await pool.query(
                `SELECT id, slot_key, label, TIME_FORMAT(run_at, '%H:%i') AS run_at FROM ${table} ORDER BY slot_key`,
            );
            // 경계를 함께 내려 화면이 '몇 시까지 이 회차인지'를 보여줄 수 있게 한다.
            res.json(
                rows.map((/** @type {any} */ r, /** @type {number} */ i) => ({
                    ...r,
                    from: rows[i - 1] ? boundary(rows[i - 1], r) : '00:00',
                    until: rows[i + 1] ? boundary(r, rows[i + 1]) : '24:00',
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
        const label =
            String(req.body.label ?? '')
                .trim()
                .slice(0, 20) || defaultLabel(runAt);
        const key = runAt.replace(':', '');
        try {
            await pool.query(`INSERT INTO ${table} (slot_key, label, run_at, sort_order) VALUES (?, ?, ?, ?)`, [
                key,
                label,
                runAt,
                Number(key),
            ]);
            await changed();
            res.json({ success: true, slot_key: key });
        } catch (/** @type {any} */ err) {
            if (err && err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ success: false, message: '이미 같은 시각의 회차가 있습니다.' });
            }
            console.error(`[🔥 POST ${what} 회차 에러]`, err);
            res.status(500).json({
                success: false,
                message: '회차를 추가하지 못했습니다.',
                debug_info: debugInfo(err),
            });
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

    return { listSlots, loadSlots, currentSlot, syncReminders, router };
}

module.exports = { createSlotSchedule, slotSql, toMinutes, toHHMM, defaultLabel };
