import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import StatCard from './stats/StatCard';
import { useNotification } from '../hooks/useNotification';

/** ISO 요일(1=월 … 7=일). 서버(utils/slotSchedule.js)가 같은 숫자를 이어 붙여 저장한다. */
const DAYS = [
    { key: '1', name: '월' },
    { key: '2', name: '화' },
    { key: '3', name: '수' },
    { key: '4', name: '목' },
    { key: '5', name: '금' },
    { key: '6', name: '토' },
    { key: '7', name: '일' },
];
const ALL_DAYS = '1234567';

/** 요일 하나를 켜고 끈 새 문자열. 정렬해 둔다('4' + '1' → '14'). */
const toggleDay = (/** @type {string} */ days, /** @type {string} */ d) =>
    (days.includes(d) ? days.replace(d, '') : days + d).split('').sort().join('');

/**
 * 요일 고르기. 요일마다 운영 시간이 달라(예: 월~수 17시 마감, 목 16시 마감, 금 미운영)
 * 회차마다 적용 요일을 둔다.
 * @param {{days: string, onToggle: (d: string) => void, disabled?: boolean}} props
 */
function DayPicker({ days, onToggle, disabled }) {
    return (
        <span className="is-days" role="group" aria-label="적용 요일">
            {DAYS.map((d) => (
                <button
                    key={d.key}
                    type="button"
                    className={`is-day ${days.includes(d.key) ? 'on' : ''}`}
                    aria-pressed={days.includes(d.key)}
                    disabled={disabled}
                    onClick={() => onToggle(d.key)}
                >
                    {d.name}
                </button>
            ))}
        </span>
    );
}

/**
 * 회차 설정 — 재고 조사와 위생 점검이 함께 쓴다(서버: utils/slotSchedule.js).
 *
 * 매장마다 근무 시간이 달라 시각을 코드에 박을 수 없다. 코드는 매장끼리 공유하므로
 * 기본 시각도 두지 않는다 — 관리자가 매장에 맞게 넣는다.
 *
 * 관리자는 '하는 시각'만 정한다. 어느 시각까지 어느 회차로 볼지(경계)는 서버가
 * 이웃한 두 시각의 가운데로 계산한다 — 경계까지 입력하게 하면 "11시 조사인데 왜 13시까지
 * 11시 회차인가"를 매번 설명해야 한다.
 *
 * @param {object} props
 * @param {string} props.endpoint   예: '/api/admin/inventory/slots'
 * @param {string} props.title      카드 제목. 예: '조사 회차'
 * @param {string} props.work       하는 일. 예: '조사', '점검' — 안내 문구에 들어간다
 * @param {import('react').ReactNode} props.emptyHint  회차가 없을 때 어떻게 동작하는지
 */
function SlotSchedule({ endpoint, title, work, emptyHint }) {
    const { notify, confirm } = useNotification();
    const [slots, setSlots] = useState(/** @type {any[]} */ ([]));
    // 특정 매장 시각을 미리 채워 두지 않는다(그대로 누르면 그 매장 시각이 들어간다).
    const [time, setTime] = useState('');
    // 비워 두면 서버가 시각으로 이름을 만든다('오후 4시'). 매장에서 부르는 이름(오픈·마감 등)이 있으면 적는다.
    const [name, setName] = useState('');
    // 새 회차의 적용 요일. 기본은 매일 — 요일이 따로 없는 매장은 건드릴 필요가 없다.
    const [newDays, setNewDays] = useState(ALL_DAYS);
    const [busyId, setBusyId] = useState(/** @type {number|null} */ (null));
    const [loading, setLoading] = useState(true);

    const authCfg = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

    const load = useCallback(async () => {
        try {
            const res = await axios.get(endpoint, authCfg());
            setSlots(res.data);
        } catch {
            notify('회차를 불러오지 못했습니다.', { icon: '⚠️', dedupeKey: `load-slots:${endpoint}` });
        } finally {
            setLoading(false);
        }
    }, [endpoint, notify]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
    }, [load]);

    const add = async () => {
        if (!time) {
            notify('추가할 시각을 골라주세요.', { icon: '⚠️' });
            return;
        }
        if (!newDays) {
            notify('요일을 하나 이상 골라주세요.', { icon: '⚠️' });
            return;
        }
        try {
            await axios.post(endpoint, { run_at: time, label: name, days: newDays }, authCfg());
            setTime('');
            setName('');
            setNewDays(ALL_DAYS);
            await load();
        } catch (/** @type {any} */ err) {
            notify(err?.response?.data?.message || '회차를 추가하지 못했습니다.', { icon: '⚠️' });
        }
    };

    /** 이미 있는 회차의 요일을 바꾼다. 마지막 요일은 끄지 못한다(그러면 빼기와 같다). @param {any} s @param {string} d */
    const changeDays = async (s, d) => {
        const next = toggleDay(s.days, d);
        if (!next) {
            notify('요일을 하나 이상 남겨주세요. 이 회차를 없애려면 빼기를 누르세요.', { icon: '⚠️' });
            return;
        }
        setBusyId(s.id);
        try {
            await axios.patch(`${endpoint}/${s.id}`, { days: next }, authCfg());
            await load();
        } catch (/** @type {any} */ err) {
            notify(err?.response?.data?.message || '요일을 바꾸지 못했습니다.', { icon: '⚠️' });
        } finally {
            setBusyId(null);
        }
    };

    /** @param {any} s */
    const remove = async (s) => {
        if (!(await confirm(`${s.label} 회차를 빼시겠습니까?`, { confirmText: '빼기' }))) return;
        try {
            await axios.delete(`${endpoint}/${s.id}`, authCfg());
            await load();
        } catch (/** @type {any} */ err) {
            notify(err?.response?.data?.message || '회차를 지우지 못했습니다.', { icon: '⚠️' });
        }
    };

    return (
        <StatCard
            title={title}
            icon="🕐"
            wide
            loading={loading}
            subtitle={slots.length > 0 ? `회차 ${slots.length}개` : '미설정'}
        >
            <style>{`
                .is-hint { font-size: .78rem; color: var(--text-secondary, #999); margin: 0 0 12px; line-height: 1.6; word-break: keep-all; }
                .is-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 10px 0; border-bottom: 1px solid var(--border-color, #f1f1f1); }
                .is-main { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 200px; }
                .is-days { display: inline-flex; gap: 3px; flex-wrap: wrap; }
                .is-day { box-sizing: border-box; width: 30px; height: 30px; padding: 0; border: 1px solid var(--border-color, #ddd); border-radius: 8px; background: none; color: var(--text-secondary, #aaa); font-family: inherit; font-size: .8rem; font-weight: 700; cursor: pointer; }
                .is-day.on { background: var(--accent-bg); border-color: var(--accent); color: var(--accent); }
                .is-day:disabled { opacity: .5; cursor: default; }
                .is-ranges { flex-basis: 100%; font-size: .78rem; color: var(--text-secondary, #aaa); line-height: 1.5; }
                .is-time { font-size: 1.05rem; font-weight: 800; color: var(--text-primary, #222); min-width: 62px; }
                .is-label { font-weight: 700; color: var(--text-primary, #333); font-size: .92rem; }
                .is-range { flex: 1; font-size: .78rem; color: var(--text-secondary, #aaa); }
                .is-add { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding-top: 12px; }
                .is-add input { box-sizing: border-box; height: 40px; padding: 0 10px; font-size: .95rem; border: 1px solid var(--border-color, #ccc); border-radius: 8px; background: var(--bg-color, #fff); color: var(--text-primary, #222); font-family: inherit; }
                .is-add input.name { flex: 1; min-width: 140px; }
                .is-btn { box-sizing: border-box; height: 40px; padding: 0 16px; font-size: .88rem; font-weight: 700; border: none; border-radius: 8px; background: var(--accent, #1a73e8); color: #fff; cursor: pointer; font-family: inherit; }
                .is-btn.ghost { height: 34px; background: none; border: 1px solid var(--border-color, #ddd); color: var(--text-secondary, #999); }
            `}</style>

            <p className="is-hint">
                직원 화면이 이 시각을 보고 회차를 자동으로 고릅니다. 조금 늦게 {work}해도 다음 회차와의 가운데를 넘지
                않으면 원래 회차로 들어갑니다 — 각 회차 아래가 그 범위입니다. 요일마다 운영 시간이 다르면 회차마다
                요일을 골라주세요. 회차가 하나도 없는 요일은 미운영일로 보고 알림을 보내지 않습니다. 회차를 바꿔도 이미
                낸 기록은 그대로입니다.
            </p>

            {!loading && slots.length === 0 && (
                <p className="is-hint">
                    <b>아직 회차가 없습니다.</b> 매장의 {work} 시각을 추가해주세요. {emptyHint}
                </p>
            )}

            {slots.map((s) => (
                <div className="is-row" key={s.id}>
                    <span className="is-main">
                        <span className="is-time">{s.run_at}</span>
                        <span className="is-label">{s.label}</span>
                    </span>
                    <DayPicker days={s.days} disabled={busyId === s.id} onToggle={(d) => void changeDays(s, d)} />
                    <button className="is-btn ghost" onClick={() => remove(s)}>
                        빼기
                    </button>
                    {/* 요일마다 함께 도는 회차가 달라 범위도 다를 수 있다. 같은 범위끼리 묶어 서버가 내려준다. */}
                    <span className="is-ranges">
                        {(s.ranges ?? [])
                            .map(
                                (/** @type {any} */ r) =>
                                    `${s.ranges.length > 1 || r.days !== ALL_DAYS ? `${r.days_text} ` : ''}${r.from} ~ ${r.until}`,
                            )
                            .join(' · ')}
                    </span>
                </div>
            ))}

            <p className="is-hint">
                이 시각에 근무자에게 &lsquo;{work}할 시간&rsquo; 알림을 보낼지는 <b>알림 설정</b>에서 켜고 끕니다.
            </p>

            <div className="is-add">
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label={`${work} 시각`} />
                <input
                    className="name"
                    value={name}
                    maxLength={20}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="이름 (선택, 예: 오픈 · 마감)"
                    aria-label="회차 이름"
                />
                <DayPicker days={newDays} onToggle={(d) => setNewDays((prev) => toggleDay(prev, d))} />
                <button className="is-btn" onClick={add}>
                    회차 추가
                </button>
            </div>
        </StatCard>
    );
}

export default SlotSchedule;
