import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import StatCard from './stats/StatCard';
import { useNotification } from '../hooks/useNotification';

/**
 * '내가 받는 알림' — 읽기 전용.
 *
 * 알림을 켜고 끄는 것은 관리자가 매장 단위로 한다. 받는 사람은 그 결과만 본다.
 * 예전에는 '받습니다'라는 문구를 화면에 박아 뒀는데, 그러면 관리자가 꺼 둬도 받는다고 나왔다.
 * 서버에서 실제 상태와 시각을 받아 그대로 보여준다.
 *
 * 문구도 서버 레지스트리의 description을 쓴다 — 알림을 추가해도 이 화면은 고칠 필요가 없다.
 *
 * @param {{title?: string}} props
 */
function MyAlerts({ title = '내가 받는 알림' }) {
    const { notify } = useNotification();
    const [alerts, setAlerts] = useState(/** @type {any[]} */ ([]));
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            const res = await axios.get('/api/alerts/mine', {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
            });
            setAlerts(res.data);
        } catch {
            notify('알림 정보를 불러오지 못했습니다.', { icon: '⚠️', dedupeKey: 'load-my-alerts' });
        } finally {
            setLoading(false);
        }
    }, [notify]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
    }, [load]);

    return (
        <StatCard title={title} icon="📬" wide loading={loading} empty={!loading && alerts.length === 0}>
            <style>{`
                .ma-row { display: flex; align-items: flex-start; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border-color, #f1f1f1); }
                .ma-row:last-child { border-bottom: none; }
                .ma-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
                .ma-name { font-size: .95rem; font-weight: 800; color: var(--text-primary, #222); }
                .ma-desc { font-size: .82rem; color: var(--text-secondary, #888); line-height: 1.5; word-break: keep-all; }
                .ma-times { font-size: .82rem; color: var(--text-primary, #444); }
                .ma-badge { flex-shrink: 0; font-size: .76rem; font-weight: 800; padding: 3px 10px; border-radius: 999px; background: var(--bg-color, #f0f0f0); color: var(--text-secondary, #999); }
                .ma-badge.on { background: var(--success-bg); color: var(--success); }
                .ma-note { margin: 10px 0 0; font-size: .78rem; color: var(--text-secondary, #999); line-height: 1.6; word-break: keep-all; }
            `}</style>

            {alerts.map((a) => (
                <div className="ma-row" key={a.key}>
                    <div className="ma-body">
                        <span className="ma-name">{a.label}</span>
                        {a.description && <span className="ma-desc">{a.description}</span>}
                        <span className="ma-times">
                            {a.enabled
                                ? a.times.length > 0
                                    ? `🕐 ${a.times.join(' · ')}`
                                    : '시각이 아직 정해지지 않았습니다'
                                : '관리자가 꺼 두었습니다'}
                        </span>
                    </div>
                    <span className={`ma-badge ${a.enabled ? 'on' : ''}`}>{a.enabled ? '켜짐' : '꺼짐'}</span>
                </div>
            ))}

            {alerts.length > 0 && (
                <p className="ma-note">
                    켜고 끄는 것은 관리자가 매장 단위로 정합니다. 위에서 알림을 켜 두시면 화면 구석의 안내 대신 기기
                    알림으로 받습니다.
                </p>
            )}
        </StatCard>
    );
}

export default MyAlerts;
