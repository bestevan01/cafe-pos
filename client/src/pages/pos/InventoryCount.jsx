import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { useNotification } from '../../hooks/useNotification';

/**
 * 측정 방식별 묶음. 화면에서 이 순서대로 나온다.
 *
 * 품목 순서가 아니라 '어디서 어떻게 세는지'로 묶는 이유: 실제 동선이 그렇다.
 * 창고에서 봉지를 세고, 냉장고 앞에서 캔을 세고, 저울을 꺼내 통을 올린다.
 * 한 묶음을 끝내고 다음 자리로 옮기면 되니 오가는 일이 줄고, 빠뜨리기도 어렵다.
 */
const GROUPS = [
    {
        mode: 'pack',
        title: '봉·줄로 세는 것',
        icon: '📦',
        // 예전 문구는 '뜯지 않은 것만'이었는데 실제로는 뜯은 것도 소수로 적고 계셨다.
        // 화면 설명과 하는 일이 다르면 사람마다 다르게 적는다.
        hint: '안 뜯은 개수 + 뜯어 쓰는 것의 남은 비율. 예) 안 뜯은 2봉 + 뜯은 것 30% → 2.3',
    },
    { mode: 'each', title: '냉장고', icon: '🧊', hint: '냉장고 안에 있는 개수' },
    {
        mode: 'weight',
        title: '저울',
        icon: '⚖️',
        hint: '통째로 저울에 올린 무게. 빈 통 무게는 앱이 뺍니다. 창고의 안 뜯은 통은 따로 적어주세요',
    },
];

/** 숫자만 남긴다. 소수점 한 개까지 허용(0.5봉지처럼). */
const clean = (/** @type {string} */ v) => {
    const s = String(v).replace(/[^0-9.]/g, '');
    const [head, ...rest] = s.split('.');
    return rest.length > 0 ? `${head}.${rest.join('').slice(0, 2)}` : head;
};

/**
 * 직원용 재고 조사 화면.
 *
 * 회차(매장마다 관리자가 정한 시각)는 서버가 자기 시계로 정한다. 직원이 고르게 하면 회차와 실제
 * 제출 시각이 어긋난 기록이 남는다(위생 점검에서 겪었다).
 *
 * @param {{onClose: () => void}} props
 */
function InventoryCount({ onClose }) {
    const { notify, confirm } = useNotification();
    const [items, setItems] = useState(/** @type {any[]} */ ([]));
    const [slot, setSlot] = useState('');
    const [slots, setSlots] = useState(/** @type {Record<string, any>} */ ({}));
    // 회차는 매장이 정한다(관리자 화면). 개수도 시각도 매장마다 달라 서버가 준 목록을 그대로 쓴다.
    const [slotList, setSlotList] = useState(/** @type {any[]} */ ([]));
    const [previous, setPrevious] = useState(/** @type {Record<string, any>} */ ({}));
    const [existing, setExisting] = useState(/** @type {any} */ (null));
    /** 품목 id → {quantity, spare} 문자열. 입력 중에는 문자열로 두어야 '0.' 같은 중간 상태가 안 깨진다. */
    const [values, setValues] = useState(/** @type {Record<string, {quantity: string, spare: string}>} */ ({}));
    const [memo, setMemo] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const authCfg = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

    const load = useCallback(async () => {
        try {
            const res = await axios.get('/api/inventory/today', authCfg());
            const { items: list, slots: bySlot, slot_list: available, current_slot: cur, previous: prev } = res.data;
            setItems(list);
            setSlots(bySlot);
            setSlotList(available ?? []);
            setSlot(cur);
            setPrevious(prev ?? {});

            const mine = bySlot?.[cur] ?? null;
            setExisting(mine);
            if (mine) {
                // 이미 낸 회차면 그때 적은 값으로 채워 '수정' 모드로 연다.
                /** @type {Record<string, {quantity: string, spare: string}>} */
                const filled = {};
                for (const r of mine.items ?? []) {
                    if (r.item_id == null) continue;
                    filled[r.item_id] = {
                        quantity: String(Number(r.quantity)),
                        spare: String(Number(r.spare_count ?? 0)),
                    };
                }
                setValues(filled);
                setMemo(mine.memo ?? '');
            } else {
                setValues({});
                setMemo('');
            }
        } catch {
            notify('재고 조사 정보를 불러오지 못했습니다.', { icon: '⚠️', dedupeKey: 'load-inventory' });
        } finally {
            setLoading(false);
        }
    }, [notify]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
    }, [load]);

    /** @param {number} id @param {'quantity'|'spare'} field @param {string} v */
    const setValue = (id, field, v) => {
        setValues((prev) => {
            const cur = prev[id] ?? { quantity: '', spare: '' };
            return { ...prev, [id]: { ...cur, [field]: clean(v) } };
        });
    };

    const grouped = useMemo(
        () =>
            GROUPS.map((g) => ({ ...g, list: items.filter((i) => i.measure_mode === g.mode) })).filter(
                (g) => g.list.length > 0,
            ),
        [items],
    );

    const filledCount = items.filter((i) => String(values[i.id]?.quantity ?? '').trim() !== '').length;

    const submit = async () => {
        const missing = items.find((i) => String(values[i.id]?.quantity ?? '').trim() === '');
        if (missing) {
            notify(`"${missing.name}" 수량을 적어주세요.`, { icon: '⚠️' });
            return;
        }
        if (
            !(await confirm(existing ? '조사 기록을 고치시겠습니까?' : '재고 조사를 제출하시겠습니까?', {
                confirmText: existing ? '수정' : '제출',
            }))
        ) {
            return;
        }

        setSaving(true);
        const body = {
            items: items.map((i) => ({
                item_id: i.id,
                quantity: Number(values[i.id].quantity),
                spare_count: i.measure_mode === 'weight' ? Number(values[i.id]?.spare || 0) : 0,
            })),
            memo,
        };
        try {
            if (existing) {
                await axios.put(`/api/inventory/counts/${existing.id}`, body, authCfg());
                notify('재고 조사 기록을 수정했습니다.', { icon: '✅' });
            } else {
                const res = await axios.post('/api/inventory/counts', body, authCfg());
                // 어느 회차로 기록됐는지는 서버가 알려준다. 경계 시각을 넘겨 제출하면 화면이
                // 들고 있던 회차와 실제로 저장된 회차가 다를 수 있다.
                notify(`${res.data?.slot_label ?? '재고'} 조사를 제출했습니다.`, { icon: '✅' });
            }
            onClose();
        } catch (/** @type {any} */ err) {
            if (err?.response?.status === 409) {
                notify('이 회차는 다른 직원이 먼저 제출했습니다. 그 기록을 불러옵니다.', { icon: '⚠️' });
                setLoading(true);
                await load();
            } else {
                notify(err?.response?.data?.message || '제출에 실패했습니다.', { icon: '⚠️' });
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="ic-overlay">
            <style>{`
                .ic-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); backdrop-filter: blur(3px); z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box; }
                .ic-modal { display: flex; flex-direction: column; width: 100%; max-width: 620px; max-height: 100%; background: var(--card-bg, #fff); border-radius: var(--radius-lg); box-shadow: var(--shadow-md); overflow: hidden; }
                .ic-head { padding: 18px 20px 12px; border-bottom: 1px solid var(--border-color, #eee); }
                .ic-title { margin: 0 0 8px; font-size: 1.25rem; font-weight: 800; color: var(--text-primary, #222); }
                .ic-slots { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
                .ic-slot { font-size: .78rem; font-weight: 700; padding: 4px 10px; border-radius: 999px; background: var(--bg-color, #f2f2f2); color: var(--text-secondary, #888); }
                .ic-slot.now { background: var(--accent-bg, #e8f0fe); color: var(--accent, #1a73e8); }
                .ic-slot.done { background: var(--success-bg); color: var(--success); }
                .ic-note { margin: 8px 0 0; font-size: .82rem; color: var(--text-secondary, #888); }
                .ic-body { flex: 1; overflow-y: auto; padding: 8px 20px 16px; }

                .ic-group { margin-top: 16px; }
                .ic-group-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
                .ic-group-name { font-size: .95rem; font-weight: 800; color: var(--text-primary, #333); }
                .ic-group-hint { font-size: .74rem; color: var(--text-secondary, #999); word-break: keep-all; }

                .ic-row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--border-color, #f1f1f1); }
                .ic-name { flex: 1; min-width: 0; font-size: .95rem; color: var(--text-primary, #333); }
                .ic-prev { display: block; font-size: .72rem; color: var(--text-secondary, #aaa); margin-top: 2px; }
                .ic-field { display: flex; align-items: center; gap: 4px; }
                .ic-field input { width: 74px; padding: 9px 8px; font-size: 1rem; text-align: right; border: 1px solid var(--border-color, #ccc); border-radius: 8px; background: var(--bg-color, #fff); color: var(--text-primary, #222); font-family: inherit; box-sizing: border-box; }
                .ic-field input:focus { outline: 2px solid var(--accent, #1a73e8); outline-offset: -1px; }
                .ic-unit { font-size: .8rem; color: var(--text-secondary, #888); min-width: 26px; }
                .ic-sub { font-size: .7rem; color: var(--text-secondary, #aaa); text-align: center; margin-bottom: 2px; }
                .ic-conv { font-size: .72rem; color: var(--text-secondary, #aaa); white-space: nowrap; min-width: 62px; text-align: right; }

                .ic-memo { width: 100%; margin-top: 18px; min-height: 60px; padding: 10px; border: 1px solid var(--border-color, #ccc); border-radius: 10px; background: var(--bg-color, #fff); color: var(--text-primary, #222); font-family: inherit; font-size: .9rem; box-sizing: border-box; resize: vertical; }

                .ic-foot { display: flex; align-items: center; gap: 10px; padding: 12px 20px; border-top: 1px solid var(--border-color, #eee); }
                .ic-count { flex: 1; font-size: .85rem; color: var(--text-secondary, #888); }
                .ic-btn { padding: 11px 18px; font-size: .95rem; font-weight: 700; border: none; border-radius: 10px; cursor: pointer; font-family: inherit; }
                .ic-btn.ghost { background: none; color: var(--text-secondary, #888); }
                .ic-btn.primary { background: var(--accent, #1a73e8); color: #fff; }
                .ic-btn:disabled { opacity: .5; cursor: default; }
                .ic-loading { padding: 40px 0; text-align: center; color: var(--text-secondary, #999); }

                @media (max-width: 620px) {
                    .ic-overlay { padding: 0; }
                    .ic-modal { max-width: none; height: 100%; border-radius: 0; }
                    .ic-conv { display: none; }
                }
            `}</style>

            <div className="ic-modal">
                <div className="ic-head">
                    <h2 className="ic-title">📦 재고 조사</h2>
                    <div className="ic-slots">
                        {slotList.map((s) => (
                            <span
                                key={s.slot_key}
                                className={`ic-slot ${s.slot_key === slot ? 'now' : ''} ${slots[s.slot_key] ? 'done' : ''}`}
                            >
                                {s.label}
                                {slots[s.slot_key] ? ' 완료' : ''}
                            </span>
                        ))}
                    </div>
                    {existing && (
                        <p className="ic-note">
                            {existing.counted_by_name}님이 제출했습니다. 고쳐서 다시 저장할 수 있습니다.
                        </p>
                    )}
                </div>

                <div className="ic-body">
                    {loading ? (
                        <p className="ic-loading">불러오는 중…</p>
                    ) : items.length === 0 ? (
                        <p className="ic-loading">조사할 품목이 없습니다. 관리자에게 문의하세요.</p>
                    ) : (
                        grouped.map((g) => (
                            <div className="ic-group" key={g.mode}>
                                <div className="ic-group-head">
                                    <span className="ic-group-name">
                                        {g.icon} {g.title}
                                    </span>
                                    <span className="ic-group-hint">{g.hint}</span>
                                </div>
                                {g.list.map((item) => {
                                    const v = values[item.id] ?? { quantity: '', spare: '' };
                                    const prev = previous[item.id];
                                    const qty = Number(v.quantity);
                                    // 비어 있을 수 있다(봉당 개수가 들쭉날쭉한 품목). 그러면 환산을 안 보여준다.
                                    const per = item.count_per_pack == null ? null : Number(item.count_per_pack);
                                    return (
                                        <div className="ic-row" key={item.id}>
                                            <span className="ic-name">
                                                {item.name}
                                                {prev && (
                                                    <span className="ic-prev">
                                                        직전 {Number(prev.quantity)}
                                                        {item.count_unit}
                                                        {item.measure_mode === 'weight' && prev.spare_count > 0
                                                            ? ` · 미개봉 ${Number(prev.spare_count)}통`
                                                            : ''}
                                                    </span>
                                                )}
                                            </span>

                                            {item.measure_mode === 'weight' && (
                                                <div>
                                                    <div className="ic-sub">미개봉</div>
                                                    <div className="ic-field">
                                                        <input
                                                            inputMode="decimal"
                                                            value={v.spare}
                                                            placeholder="0"
                                                            onChange={(e) => setValue(item.id, 'spare', e.target.value)}
                                                            aria-label={`${item.name} 미개봉 수량`}
                                                        />
                                                        <span className="ic-unit">통</span>
                                                    </div>
                                                </div>
                                            )}

                                            <div>
                                                {item.measure_mode === 'weight' && <div className="ic-sub">저울</div>}
                                                <div className="ic-field">
                                                    <input
                                                        inputMode="decimal"
                                                        value={v.quantity}
                                                        onChange={(e) => setValue(item.id, 'quantity', e.target.value)}
                                                        aria-label={`${item.name} 수량`}
                                                    />
                                                    <span className="ic-unit">{item.count_unit}</span>
                                                </div>
                                            </div>

                                            {/* 입력한 숫자가 실제로 얼마인지 옆에 보여준다. 자리를 잘못 눌렀을 때 알아차리기 쉽다. */}
                                            <span className="ic-conv">
                                                {v.quantity !== '' &&
                                                Number.isFinite(qty) &&
                                                item.measure_mode === 'pack' &&
                                                per &&
                                                per !== 1
                                                    ? `≈ ${Math.round(qty * per).toLocaleString()}${item.base_unit}`
                                                    : ''}
                                                {item.measure_mode === 'weight' &&
                                                item.tare_g != null &&
                                                v.quantity !== ''
                                                    ? `순 ${Math.max(0, Math.round(qty - Number(item.tare_g))).toLocaleString()}g`
                                                    : ''}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        ))
                    )}

                    {!loading && items.length > 0 && (
                        <textarea
                            className="ic-memo"
                            placeholder="특이사항이 있으면 적어주세요 (선택)"
                            value={memo}
                            onChange={(e) => setMemo(e.target.value)}
                        />
                    )}
                </div>

                <div className="ic-foot">
                    <span className="ic-count">{items.length > 0 && `${filledCount} / ${items.length}`}</span>
                    <button className="ic-btn ghost" onClick={onClose}>
                        닫기
                    </button>
                    <button
                        className="ic-btn primary"
                        onClick={submit}
                        disabled={saving || loading || items.length === 0}
                    >
                        {saving ? '저장 중…' : existing ? '수정 저장' : '제출'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default InventoryCount;
