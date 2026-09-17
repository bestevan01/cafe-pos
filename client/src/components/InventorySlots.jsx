import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import StatCard from './stats/StatCard';
import { useNotification } from '../hooks/useNotification';

/**
 * 재고 조사 회차 설정.
 *
 * 매장마다 근무 시간이 달라 시각을 코드에 박을 수 없다. 코드는 매장끼리 공유하므로
 * 기본 시각도 두지 않는다 — 관리자가 매장에 맞게 넣는다.
 *
 * 관리자는 '조사하는 시각'만 정한다. 어느 시각까지 어느 회차로 볼지(경계)는 서버가
 * 이웃한 두 시각의 가운데로 계산한다 — 경계까지 입력하게 하면 "11시 조사인데 왜 13시까지
 * 11시 회차인가"를 매번 설명해야 한다.
 */
function InventorySlots() {
    const { notify, confirm } = useNotification();
    const [slots, setSlots] = useState(/** @type {any[]} */ ([]));
    // 특정 매장 시각을 미리 채워 두지 않는다(그대로 누르면 그 매장 시각이 들어간다).
    const [time, setTime] = useState('');
    const [loading, setLoading] = useState(true);

    const authCfg = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

    const load = useCallback(async () => {
        try {
            const res = await axios.get('/api/admin/inventory/slots', authCfg());
            setSlots(res.data);
        } catch {
            notify('회차를 불러오지 못했습니다.', { icon: '⚠️', dedupeKey: 'load-slots' });
        } finally {
            setLoading(false);
        }
    }, [notify]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
    }, [load]);

    const add = async () => {
        if (!time) {
            notify('추가할 시각을 골라주세요.', { icon: '⚠️' });
            return;
        }
        try {
            await axios.post('/api/admin/inventory/slots', { run_at: time }, authCfg());
            setTime('');
            await load();
        } catch (/** @type {any} */ err) {
            notify(err?.response?.data?.message || '회차를 추가하지 못했습니다.', { icon: '⚠️' });
        }
    };

    /** @param {any} s */
    const remove = async (s) => {
        if (!(await confirm(`${s.label} 회차를 빼시겠습니까?`, { confirmText: '빼기' }))) return;
        try {
            await axios.delete(`/api/admin/inventory/slots/${s.id}`, authCfg());
            await load();
        } catch (/** @type {any} */ err) {
            notify(err?.response?.data?.message || '회차를 지우지 못했습니다.', { icon: '⚠️' });
        }
    };

    return (
        <StatCard
            title="조사 회차"
            icon="🕐"
            wide
            loading={loading}
            subtitle={slots.length > 0 ? `하루 ${slots.length}번` : '미설정'}
        >
            <style>{`
                .is-hint { font-size: .78rem; color: var(--text-secondary, #999); margin: 0 0 12px; line-height: 1.6; word-break: keep-all; }
                .is-row { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border-color, #f1f1f1); }
                .is-time { font-size: 1.05rem; font-weight: 800; color: var(--text-primary, #222); min-width: 62px; }
                .is-label { font-weight: 700; color: var(--text-primary, #333); font-size: .92rem; }
                .is-range { flex: 1; font-size: .78rem; color: var(--text-secondary, #aaa); }
                .is-add { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding-top: 12px; }
                .is-add input { padding: 9px 10px; font-size: .95rem; border: 1px solid var(--border-color, #ccc); border-radius: 8px; background: var(--bg-color, #fff); color: var(--text-primary, #222); font-family: inherit; }
                .is-btn { padding: 9px 16px; font-size: .88rem; font-weight: 700; border: none; border-radius: 8px; background: var(--accent, #1a73e8); color: #fff; cursor: pointer; font-family: inherit; }
                .is-btn.ghost { background: none; border: 1px solid var(--border-color, #ddd); color: var(--text-secondary, #999); }
            `}</style>

            <p className="is-hint">
                직원 화면이 이 시각을 보고 회차를 자동으로 고릅니다. 조사가 조금 늦어도 다음 회차와의 가운데를 넘지
                않으면 원래 회차로 들어갑니다 — 괄호 안이 그 범위입니다.
            </p>

            {!loading && slots.length === 0 && (
                <p className="is-hint">
                    <b>아직 회차가 없습니다.</b> 매장의 조사 시각을 추가해주세요. 추가하기 전까지는 하루 한 번(
                    &lsquo;조사&rsquo;)으로 기록되고, 조사 시각 알림도 나가지 않습니다.
                </p>
            )}

            {slots.map((s) => (
                <div className="is-row" key={s.id}>
                    <span className="is-time">{s.run_at}</span>
                    <span className="is-label">{s.label}</span>
                    <span className="is-range">
                        ({s.from} ~ {s.until})
                    </span>
                    <button className="is-btn ghost" onClick={() => remove(s)}>
                        빼기
                    </button>
                </div>
            ))}

            <p className="is-hint">
                이 시각에 근무자에게 &lsquo;조사할 시간&rsquo; 알림을 보낼지는 <b>알림 설정</b>에서 켜고 끕니다.
            </p>

            <div className="is-add">
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="조사 시각" />
                <button className="is-btn" onClick={add}>
                    회차 추가
                </button>
            </div>
        </StatCard>
    );
}

export default InventorySlots;
