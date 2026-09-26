import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import StatCard from './stats/StatCard';
import { useNotification } from '../hooks/useNotification';
import { socket } from '../utils/socket';
import { getStoreInfo } from '../utils/storeInfo';

/**
 * 알림 하나의 설정 카드. 알림 종류 하나를 맡는다.
 *
 * 특정 기능에 묶지 않는다 — `<AlertSchedule alertKey="..." />` 한 줄로 쓴다.
 * 무엇을 알릴지는 서버 레지스트리(utils/alerts.js)가 정하고, 여기서는 언제 켤지만 다룬다.
 *
 * 알림은 두 종류다.
 *  - 시각을 관리자가 정하는 알림(주문 필요 등): 시각을 더하고 빼고, 하나씩 켜고 끈다
 *  - 시각을 코드가 맞추는 알림(managed, 조사 시각 알림 등): 다른 설정의 시각을 그대로 따라간다.
 *    여기서 시각을 바꾸면 다음 동기화 때 되돌아가므로, 시각은 보여주기만 하고 켜고 끄기만 둔다.
 *
 * 알림 설정은 알림 설정 화면 한 곳에 모은다. 기능 화면에 흩어 두면 같은 설정이 두 곳에
 * 생겨 어디서 바꿔야 하는지 헷갈린다(재고 품목 관리에 있던 것을 옮겼다).
 *
 * @param {{alertKey: string, title?: string, hint?: string, timesFrom?: string}} props
 *        timesFrom: managed 알림의 시각을 어디서 바꾸는지 알려줄 문구
 */
function AlertSchedule({ alertKey, title = '알림', hint, timesFrom }) {
    const { notify } = useNotification();
    const storeName = getStoreInfo()?.label ?? '이 매장';
    const [schedules, setSchedules] = useState(/** @type {any[]} */ ([]));
    const [type, setType] = useState(/** @type {{label: string, audience: string, managed: boolean}|null} */ (null));
    const [time, setTime] = useState('09:30');
    const [loading, setLoading] = useState(true);

    const authCfg = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

    const load = useCallback(async () => {
        try {
            const res = await axios.get('/api/admin/alerts', authCfg());
            setSchedules((res.data.schedules ?? []).filter((/** @type {any} */ s) => s.alert_key === alertKey));
            setType(res.data.types?.find((/** @type {any} */ t) => t.key === alertKey) ?? null);
        } catch {
            notify('알림 설정을 불러오지 못했습니다.', { icon: '⚠️', dedupeKey: 'load-alerts' });
        } finally {
            setLoading(false);
        }
    }, [alertKey, notify]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
    }, [load]);

    const managed = Boolean(type?.managed);
    // 하나라도 켜져 있으면 켜진 것으로 본다. managed 알림은 시각별로 따로 끄는 화면을 두지 않는다.
    const allOn = schedules.some((s) => s.is_enabled);

    const add = async () => {
        try {
            await axios.post('/api/admin/alerts', { alert_key: alertKey, run_at: time }, authCfg());
            await load();
        } catch (/** @type {any} */ err) {
            notify(err?.response?.data?.message || '시각을 추가하지 못했습니다.', { icon: '⚠️' });
        }
    };

    /** @param {any} s */
    const toggle = async (s) => {
        try {
            await axios.patch(`/api/admin/alerts/${s.id}`, { is_enabled: !s.is_enabled }, authCfg());
            await load();
        } catch {
            notify('설정을 바꾸지 못했습니다.', { icon: '⚠️' });
        }
    };

    const toggleAll = async () => {
        try {
            await axios.patch(`/api/admin/alerts/key/${alertKey}`, { is_enabled: !allOn }, authCfg());
            await load();
        } catch {
            notify('설정을 바꾸지 못했습니다.', { icon: '⚠️' });
        }
    };

    /** @param {any} s */
    const remove = async (s) => {
        try {
            await axios.delete(`/api/admin/alerts/${s.id}`, authCfg());
            await load();
        } catch {
            notify('시각을 지우지 못했습니다.', { icon: '⚠️' });
        }
    };

    const test = async () => {
        if (!socket.id) return notify('실시간 연결이 끊겨 있습니다.', { icon: '📡' });
        try {
            // 누른 사람에게만 보낸다. 시험 삼아 누른 알림이 남의 화면에 뜨면 안 된다.
            const res = await axios.post(`/api/admin/alerts/${alertKey}/test`, { socket_id: socket.id }, authCfg());
            if (!res.data.success) notify(res.data.message || '지금은 알릴 내용이 없습니다.', { icon: '🔔' });
        } catch {
            notify('알림을 보내보지 못했습니다.', { icon: '⚠️' });
        }
    };

    // 누구에게 가는지. 대상마다 받는 방식도 다르다(근무자 알림은 푸시를 쓰지 않는다).
    const audienceText =
        type?.audience === 'staff'
            ? `${storeName} 근무자 중 지금 앱을 열어 둔 사람에게만 갑니다. 쉬는 사람의 휴대폰은 울리지 않습니다.`
            : `${storeName} 관리자 중 알림을 켜 둔 사람 모두에게 갑니다. 알림을 받을지는 기기마다 따로 켭니다 — 위쪽 「이 기기에서 알림 받기」에서 켜주세요.`;

    return (
        <StatCard
            title={title}
            icon="🔔"
            wide
            loading={loading}
            // 제목에 이미 알림 이름이 들어 있으면 부제목으로 또 쓰지 않는다('재고 조사 시각 알림'이 두 번 나왔다).
            subtitle={type?.label && !title.includes(type.label) ? type.label : null}
        >
            <style>{`
                .as-hint { font-size: .78rem; color: var(--text-secondary, #999); margin: 0 0 12px; word-break: keep-all; line-height: 1.6; }
                .as-perm { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px; border-radius: 10px; background: var(--bg-color, #f7f7f7); margin-bottom: 14px; font-size: .88rem; color: var(--text-primary, #333); }
                .as-perm.on { background: var(--success-bg); }
                .as-perm .grow { flex: 1; min-width: 180px; display: flex; flex-direction: column; gap: 3px; }
                .as-sub { font-size: .78rem; color: var(--text-secondary, #999); line-height: 1.5; word-break: keep-all; }
                .as-btn { padding: 8px 14px; font-size: .85rem; font-weight: 700; border: none; border-radius: 8px; background: var(--accent, #1a73e8); color: #fff; cursor: pointer; font-family: inherit; }
                .as-btn.ghost { background: none; border: 1px solid var(--border-color, #ddd); color: var(--text-secondary, #888); }
                .as-row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--border-color, #f1f1f1); }
                .as-time { font-size: 1.05rem; font-weight: 700; color: var(--text-primary, #222); min-width: 62px; }
                .as-state { flex: 1; font-size: .8rem; color: var(--text-secondary, #999); }
                .as-off .as-time, .as-off .as-state { color: var(--text-secondary, #bbb); text-decoration: line-through; }
                .as-add { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding-top: 12px; }
                .as-add input { padding: 9px 10px; font-size: .95rem; border: 1px solid var(--border-color, #ccc); border-radius: 8px; background: var(--bg-color, #fff); color: var(--text-primary, #222); font-family: inherit; }
            `}</style>

            {hint && <p className="as-hint">{hint}</p>}

            <div className={`as-perm ${managed && allOn ? 'on' : ''}`}>
                <span className="grow">
                    {/* '매장 전체'라고 쓰면 모든 매장으로 읽힌다. 매장마다 서버·DB가 따로라
                        이 설정은 지금 접속한 매장에만 적용된다 — 이름을 박아 오해를 없앤다. */}
                    <b>{managed ? (allOn ? '🔔 켜져 있습니다' : '🔕 꺼져 있습니다') : `${storeName}에만 적용됩니다`}</b>
                    <span className="as-sub">{audienceText}</span>
                </span>
                {managed && schedules.length > 0 && (
                    <button className={`as-btn ${allOn ? 'ghost' : ''}`} onClick={toggleAll}>
                        {allOn ? '끄기' : '켜기'}
                    </button>
                )}
                <button className="as-btn ghost" onClick={test}>
                    지금 보내보기
                </button>
            </div>

            {managed && timesFrom && <p className="as-hint">{timesFrom}</p>}

            {schedules.map((s) => (
                <div className={`as-row ${s.is_enabled ? '' : 'as-off'}`} key={s.id}>
                    <span className="as-time">{s.run_at}</span>
                    <span className="as-state">
                        {s.is_enabled ? '켜짐' : '꺼짐'}
                        {s.last_fired_date ? ` · 마지막 발송 ${s.last_fired_date}` : ''}
                    </span>
                    {/* managed 알림은 시각을 여기서 바꾸지 않는다(다음 동기화 때 되돌아간다). */}
                    {!managed && (
                        <>
                            <button className="as-btn ghost" onClick={() => toggle(s)}>
                                {s.is_enabled ? '끄기' : '켜기'}
                            </button>
                            <button className="as-btn ghost" onClick={() => remove(s)}>
                                지우기
                            </button>
                        </>
                    )}
                </div>
            ))}
            {schedules.length === 0 && (
                <p className="as-hint">{managed ? '따라갈 시각이 아직 없습니다.' : '아직 정해진 시각이 없습니다.'}</p>
            )}

            {!managed && (
                <div className="as-add">
                    <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="알릴 시각" />
                    <button className="as-btn" onClick={add}>
                        시각 추가
                    </button>
                </div>
            )}
        </StatCard>
    );
}

export default AlertSchedule;
