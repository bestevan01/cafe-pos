import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import StatsLayout from '../../components/stats/StatsLayout';
import StatCard from '../../components/stats/StatCard';
import ThemeToggle from '../../components/ThemeToggle';
import { socket } from '../../utils/socket';
import { useNotification } from '../../hooks/useNotification';
import InventoryItems from './InventoryItems';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 서버가 'YYYY-MM-DD' 문자열로 준다. new Date(문자열)은 UTC로 해석돼 하루 밀리므로 직접 쪼갠다. */
const weekdayOf = (/** @type {string} */ ds) => {
    const [y, m, d] = ds.split('-').map(Number);
    return WEEKDAYS[new Date(y, m - 1, d).getDay()];
};

const hhmm = (/** @type {string} */ v) => {
    const d = new Date(v);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 소수점 끝의 0을 지운다. 2.00 → 2, 0.50 → 0.5 */
const num = (/** @type {number} */ n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * 한 품목의 남은 양을 사람이 읽는 말로.
 *
 * 봉 단위 품목은 '0.8봉'처럼 한 덩어리로 보여주면 위험이 묻힌다. 0.8봉은 안 뜯은 여분이
 * 하나도 없다는 뜻이고, 1.2봉은 한 봉이 통째로 남아 있다는 뜻인데 숫자만 보면 비슷해 보인다.
 * 그래서 안 뜯은 개수와 뜯어 쓰는 것의 남은 비율을 갈라 적는다.
 *
 * 저울 품목은 무게보다 통 단위가 와닿는다 — 눈대중으로 '0.5통'이라 부르던 감각이라서다.
 * @param {any} r
 */
function remainText(r) {
    if (r.measure_mode === 'weight') {
        if (r.tare_missing) return `${num(r.quantity)}g (빈 통 무게 미측정)`;
        const spare = Number(r.spare_count) > 0 ? ` + 미개봉 ${num(r.spare_count)}통` : '';
        return `${num(r.net)}g${spare}`;
    }
    if (r.measure_mode === 'each') return `${num(r.quantity)}${r.count_unit}`;

    // 창고 품목
    const unopened = Number(r.unopened ?? 0);
    const opened = Number(r.opened_ratio ?? 0);
    const head = unopened > 0 ? `미개봉 ${num(unopened)}${r.count_unit}` : '미개봉 없음';
    const tail = opened > 0 ? ` · 뜯은 것 ${Math.round(opened * 100)}%` : '';
    return head + tail;
}

/**
 * 관리자용 재고 현황.
 *
 * '주문 필요' 판단은 서버가 한다. 화면마다 따로 계산하면 기준이 갈라진다.
 * @param {{onBack: () => void}} props
 */
function InventoryDashboard({ onBack }) {
    const { notify } = useNotification();
    const [view, setView] = useState(/** @type {'home'|'items'} */ ('home'));
    const [latest, setLatest] = useState(/** @type {any} */ (null));
    const [history, setHistory] = useState(/** @type {any[]} */ ([]));
    const [openId, setOpenId] = useState(/** @type {number|null} */ (null));
    const [loading, setLoading] = useState(true);

    const authCfg = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

    const load = useCallback(async () => {
        try {
            const [cur, list] = await Promise.all([
                axios.get('/api/admin/inventory/latest', authCfg()),
                axios.get('/api/admin/inventory/counts', authCfg()),
            ]);
            setLatest(cur.data);
            setHistory(list.data.counts ?? []);
        } catch {
            notify('재고 현황을 불러오지 못했습니다.', { icon: '⚠️', dedupeKey: 'load-inventory-admin' });
        } finally {
            setLoading(false);
        }
    }, [notify]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
        // 직원이 제출하면 새로고침 없이 반영된다. 관리자는 이 화면을 띄워두고 보는 일이 많다.
        const refresh = () => void load();
        socket.on('inventory_updated', refresh);
        return () => {
            socket.off('inventory_updated', refresh);
        };
    }, [load]);

    if (view === 'items')
        return (
            <InventoryItems
                onBack={() => {
                    setView('home');
                    void load();
                }}
            />
        );

    const rows = latest?.rows ?? [];
    const low = rows.filter((/** @type {any} */ r) => r.is_low);

    const navActions = (
        <button className="inv-nav" onClick={() => setView('items')}>
            📋 품목 관리
        </button>
    );

    return (
        <StatsLayout title="📦 재고 현황" onBack={onBack} actions={<ThemeToggle />} pageActions={navActions}>
            <style>{`
                .inv-nav { padding: 8px 14px; font-size: .9rem; font-weight: 700; border: 1px solid var(--border-color, #ddd); border-radius: 10px; background: var(--card-bg, #fff); color: var(--text-primary, #333); cursor: pointer; font-family: inherit; }
                .inv-when { font-size: .85rem; color: var(--text-secondary, #888); margin: 0 0 12px; }

                .inv-low { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 4px; }
                .inv-low-chip { font-size: .88rem; font-weight: 700; padding: 6px 12px; border-radius: 999px; background: var(--danger-bg); color: var(--danger); }
                .inv-ok { color: var(--text-secondary, #999); font-size: .9rem; }

                .inv-group { margin-top: 14px; }
                .inv-group-name { font-size: .82rem; font-weight: 800; color: var(--text-secondary, #888); margin: 0 0 6px; }
                .inv-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border-color, #f1f1f1); font-size: .93rem; }
                .inv-row.low { color: var(--danger); font-weight: 700; }
                .inv-label { flex: 1; min-width: 0; }
                .inv-amount { white-space: nowrap; }
                .inv-ratio { font-size: .76rem; color: var(--text-secondary, #aaa); margin-left: 6px; }
                .inv-row.low .inv-ratio { color: var(--danger); }
                .inv-delta { min-width: 58px; text-align: right; font-size: .8rem; color: var(--text-secondary, #aaa); white-space: nowrap; }
                .inv-delta.down { color: var(--danger); }
                .inv-tag { font-size: .72rem; font-weight: 700; padding: 2px 7px; border-radius: 999px; background: var(--danger-bg); color: var(--danger); white-space: nowrap; }

                .inv-hist { border-bottom: 1px solid var(--border-color, #eee); }
                .inv-hist-head { display: flex; align-items: center; gap: 10px; width: 100%; padding: 11px 4px; background: none; border: none; font-family: inherit; font-size: .92rem; color: var(--text-primary, #333); cursor: pointer; text-align: left; }
                .inv-hist-date { font-weight: 700; }
                .inv-hist-slot { font-size: .76rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--accent-bg, #e8f0fe); color: var(--accent, #1a73e8); }
                .inv-hist-who { flex: 1; color: var(--text-secondary, #888); font-size: .85rem; }
                .inv-hist-body { padding: 2px 4px 14px; }
                .inv-memo { margin-top: 10px; padding: 9px 11px; border-radius: 8px; background: var(--bg-color, #f7f7f7); color: var(--text-secondary, #777); font-size: .85rem; }
                .inv-empty { color: var(--text-secondary, #999); font-size: .9rem; padding: 8px 4px; }
            `}</style>

            <StatCard
                title="주문 필요"
                icon="🛒"
                wide
                loading={loading}
                subtitle={
                    latest?.count
                        ? `${latest.count.count_date} ${latest.count.slot_label ?? latest.count.slot} 기준`
                        : null
                }
            >
                {!latest?.count ? (
                    <p className="inv-empty">아직 재고 조사 기록이 없습니다.</p>
                ) : low.length === 0 ? (
                    <p className="inv-ok">모든 품목이 기준치 이상입니다.</p>
                ) : (
                    <div className="inv-low">
                        {low.map((/** @type {any} */ r) => (
                            <span className="inv-low-chip" key={r.item_id ?? r.item_label}>
                                {r.item_label} {remainText(r)}
                            </span>
                        ))}
                    </div>
                )}
            </StatCard>

            <StatCard
                title="현재 재고"
                icon="📦"
                wide
                loading={loading}
                empty={!latest?.count}
                subtitle={latest?.count ? `${latest.count.counted_by_name} · ${hhmm(latest.count.counted_at)}` : null}
            >
                {['pack', 'each', 'weight'].map((mode) => {
                    const list = rows.filter((/** @type {any} */ r) => r.measure_mode === mode);
                    if (list.length === 0) return null;
                    const name = mode === 'pack' ? '봉·줄로 세는 것' : mode === 'each' ? '냉장고' : '저울';
                    return (
                        <div className="inv-group" key={mode}>
                            <p className="inv-group-name">{name}</p>
                            {list.map((/** @type {any} */ r) => (
                                <div className={`inv-row ${r.is_low ? 'low' : ''}`} key={r.item_id ?? r.item_label}>
                                    <span className="inv-label">{r.item_label}</span>
                                    <span className="inv-amount">
                                        {remainText(r)}
                                        {r.measure_mode === 'weight' && r.total_ratio != null && (
                                            <span className="inv-ratio">({num(r.total_ratio)}통)</span>
                                        )}
                                        {r.measure_mode === 'pack' && r.amount != null && (
                                            <span className="inv-ratio">
                                                ({num(r.amount)}
                                                {r.base_unit})
                                            </span>
                                        )}
                                    </span>
                                    {/* 직전 회차 대비 증감. 얼마나 빨리 줄고 있는지가 주문 시점을 정한다. */}
                                    <span className={`inv-delta ${r.delta < 0 ? 'down' : ''}`}>
                                        {r.delta === null || r.delta === 0
                                            ? ''
                                            : `${r.delta > 0 ? '+' : ''}${num(r.delta)}`}
                                    </span>
                                    {r.is_low && <span className="inv-tag">주문</span>}
                                </div>
                            ))}
                        </div>
                    );
                })}
                {latest?.count?.memo && <div className="inv-memo">특이사항: {latest.count.memo}</div>}
            </StatCard>

            <StatCard
                title="조사 기록"
                icon="🗒️"
                wide
                loading={loading}
                empty={history.length === 0}
                subtitle={history.length > 0 ? `최근 ${history.length}회차` : null}
            >
                {history.map((c) => (
                    <div className="inv-hist" key={c.id}>
                        <button className="inv-hist-head" onClick={() => setOpenId(openId === c.id ? null : c.id)}>
                            <span className="inv-hist-date">
                                {c.count_date} ({weekdayOf(c.count_date)})
                            </span>
                            <span className="inv-hist-slot">{c.slot_label ?? c.slot}</span>
                            <span className="inv-hist-who">
                                {c.counted_by_name} · {hhmm(c.counted_at)}
                            </span>
                            {c.low_count > 0 && <span className="inv-tag">주문 {c.low_count}건</span>}
                            <span>{openId === c.id ? '▲' : '▼'}</span>
                        </button>
                        {openId === c.id && (
                            <div className="inv-hist-body">
                                {c.items.map((/** @type {any} */ r, /** @type {number} */ i) => (
                                    <div className={`inv-row ${r.is_low ? 'low' : ''}`} key={i}>
                                        <span className="inv-label">{r.item_label}</span>
                                        <span className="inv-amount">
                                            {num(r.quantity)}
                                            {r.count_unit}
                                            {r.measure_mode === 'weight' && Number(r.spare_count) > 0
                                                ? ` + 미개봉 ${num(r.spare_count)}통`
                                                : ''}
                                        </span>
                                    </div>
                                ))}
                                {c.memo && <div className="inv-memo">특이사항: {c.memo}</div>}
                            </div>
                        )}
                    </div>
                ))}
            </StatCard>
        </StatsLayout>
    );
}

export default InventoryDashboard;
