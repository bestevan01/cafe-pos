import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { useNotification } from '../../hooks/useNotification';
import { slotNames } from '../../utils/slotNames';

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
        // '안 뜯은/뜯은'이 아니라 '다 찬/쓰던'으로 부른다. 박스를 먼저 다 뜯어 두는 매장(은혜관)은
        // 박스 안에 가득 찬 줄이 있어도 '안 뜯은 것'이라 부르기 애매해 헷갈렸다. 판단에 필요한 건
        // 포장 상태가 아니라 가득 찬 게 몇 개인지다. 과자처럼 낱개로 세는 품목도 이 묶음에 '개'로 들어온다.
        hint: '다 찬 것의 개수 + 쓰던 것의 남은 비율. 예) 다 찬 2봉 + 쓰던 봉 30% → 2.3 · 박스를 뜯었어도 가득 찬 줄·봉은 다 찬 것 · 단위가 「개」면 개수 그대로',
    },
    { mode: 'each', title: '냉장고', icon: '🧊', hint: '냉장고 안에 있는 개수' },
    {
        mode: 'weight',
        title: '저울',
        icon: '⚖️',
        hint: '쓰고 있는 통·봉지를 통째로 저울에 올린 무게(빈 용기 무게는 앱이 뺍니다) · 안 뜯은 것은 미개봉 칸에 · 저울이 넘치면 「넘침」',
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
    // 오늘은 적용되는 회차가 없는 요일(미운영일). 막지는 않고 알린다 — 누가 나와 조사할 수도 있다.
    const [offDay, setOffDay] = useState(false);
    const [previous, setPrevious] = useState(/** @type {Record<string, any>} */ ({}));
    const [existing, setExisting] = useState(/** @type {any} */ (null));
    /**
     * 품목 id → {quantity, spare} 문자열. 입력 중에는 문자열로 두어야 '0.' 같은 중간 상태가 안 깨진다.
     * over는 저울 품목이 저울 최대 무게를 넘었다는 표시(거의 가득 찬 통). 그때는 무게를 적지 않는다.
     */
    const [values, setValues] = useState(
        /** @type {Record<string, {quantity: string, spare: string, over?: boolean}>} */ ({}),
    );
    // 매장 저울의 최대 무게(g). 이 이상은 잴 수 없어 '넘침'으로 받는다.
    const [scaleMax, setScaleMax] = useState(1000);
    const [memo, setMemo] = useState('');
    // 저장하지 않은 입력이 있는지. 그대로 닫으면 사라지므로 닫기 전에 묻는다.
    const [dirty, setDirty] = useState(false);
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
            setOffDay(Boolean(res.data.off_day));
            setPrevious(prev ?? {});
            setScaleMax(Number(res.data.scale_max_g) || 1000);

            // 지금 회차에 기록이 없어도 오늘 임시 저장해 둔 조사가 있으면 그걸 이어서 연다.
            // 조사하다 자리를 비운 사이 회차 경계를 넘길 수 있다 — 그때 빈 화면이 뜨면 적어 둔 숫자를
            // 잃어버린 줄 안다. 이어서 제출하면 처음 저장한 회차로 기록된다(숫자를 센 때가 그 회차다).
            const draft = Object.values(bySlot ?? {})
                .filter((c) => c?.is_draft)
                .sort((a, b) => String(b.slot).localeCompare(String(a.slot)))[0];
            const mine = bySlot?.[cur] ?? draft ?? null;
            setSlot(mine?.slot ?? cur);
            setExisting(mine);
            if (mine) {
                // 이미 낸(또는 임시 저장한) 회차면 그때 적은 값으로 채운다. 임시 저장의 빈 칸은 null로 온다.
                /** @type {Record<string, {quantity: string, spare: string, over?: boolean}>} */
                const filled = {};
                for (const r of mine.items ?? []) {
                    if (r.item_id == null) continue;
                    const over = r.over_scale === 1;
                    filled[r.item_id] = {
                        quantity: over || r.quantity == null ? '' : String(Number(r.quantity)),
                        spare: r.spare_count == null ? '' : String(Number(r.spare_count)),
                        over,
                    };
                }
                setValues(filled);
                setMemo(mine.memo ?? '');
            } else {
                setValues({});
                setMemo('');
            }
            setDirty(false);
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
        setDirty(true);
        setValues((prev) => {
            const cur = prev[id] ?? { quantity: '', spare: '' };
            return { ...prev, [id]: { ...cur, [field]: clean(v) } };
        });
    };

    /**
     * 저울 품목의 무게. 저울 최대 무게 이상을 적으면 '넘침'으로 바꾼다 — 저울이 넘치면
     * 화면에 뜬 숫자 자체를 믿을 수 없어서, 적은 숫자를 그대로 두지 않는다.
     * @param {number} id @param {string} v
     */
    const setWeight = (id, v) => {
        const cleaned = clean(v);
        const over = cleaned !== '' && Number(cleaned) >= scaleMax;
        setDirty(true);
        setValues((prev) => {
            const cur = prev[id] ?? { quantity: '', spare: '' };
            return { ...prev, [id]: { ...cur, quantity: over ? '' : cleaned, over: over || cur.over } };
        });
    };

    /** '넘침'을 켜고 끈다. 켜면 적어 둔 무게는 지운다. @param {number} id */
    const toggleOver = (id) => {
        setDirty(true);
        setValues((prev) => {
            const cur = prev[id] ?? { quantity: '', spare: '' };
            return { ...prev, [id]: { ...cur, quantity: '', over: !cur.over } };
        });
    };

    /** 입력을 마쳤는지. 저울이 넘친 품목은 무게 없이도 마친 것이다. @param {any} i */
    const isFilled = (i) => Boolean(values[i.id]?.over) || String(values[i.id]?.quantity ?? '').trim() !== '';

    const grouped = useMemo(
        () =>
            GROUPS.map((g) => ({ ...g, list: items.filter((i) => i.measure_mode === g.mode) })).filter(
                (g) => g.list.length > 0,
            ),
        [items],
    );

    const filledCount = items.filter(isFilled).length;
    const complete = items.length > 0 && filledCount === items.length;
    const isDraft = Boolean(existing?.is_draft);
    // 이미 제출한 기록. 임시 저장으로 되돌릴 수 없으니(현재 재고·알림에 이미 쓰였다) 빈 칸이 있으면 막는다.
    const isFinal = Boolean(existing) && !isDraft;

    /**
     * 저장. 모든 칸이 차 있으면 제출(기록이 된다), 비어 있는 칸이 있으면 임시 저장이다.
     * 임시 저장은 기록이 아니다 — 현재 재고·주문 필요 알림에 잡히지 않고, 나중에 이어서 채워 제출해야 한다.
     */
    const submit = async () => {
        const missing = items.find((i) => !isFilled(i));
        const draft = Boolean(missing);
        if (missing && isFinal) {
            notify(`"${missing.name}" 수량을 적어주세요.`, { icon: '⚠️' });
            return;
        }
        if (draft && !dirty && isDraft) {
            // 바뀐 게 없으면 다시 저장할 필요가 없다. 자리를 비우려던 것이니 그냥 닫는다.
            onClose();
            return;
        }
        const question = draft
            ? `${items.length - filledCount}개 품목이 비어 있어 임시 저장합니다. 나중에 모두 채워 제출해야 기록됩니다.`
            : isFinal
              ? '조사 기록을 고치시겠습니까?'
              : '재고 조사를 제출하시겠습니까?';
        if (!(await confirm(question, { confirmText: draft ? '임시 저장' : isFinal ? '수정' : '제출' }))) {
            return;
        }

        setSaving(true);
        const body = {
            draft,
            items: items.map((i) => {
                const v = values[i.id];
                const over = i.measure_mode === 'weight' && Boolean(v?.over);
                const quantity = String(v?.quantity ?? '');
                const spare = String(v?.spare ?? '');
                return {
                    item_id: i.id,
                    // 넘친 통은 서버가 저울 최대 무게로 기록한다('이 이상').
                    // 빈 칸은 null로 보낸다. 0은 '다 떨어졌다'는 뜻이라 구별해야 한다.
                    quantity: over ? scaleMax : quantity === '' ? null : Number(quantity),
                    over_scale: over,
                    spare_count: i.measure_mode === 'weight' && spare !== '' ? Number(spare) : null,
                };
            }),
            memo,
        };
        try {
            if (existing) {
                await axios.put(`/api/inventory/counts/${existing.id}`, body, authCfg());
                notify(
                    draft
                        ? '임시 저장했습니다.'
                        : isDraft
                          ? `${existing.slot_label ?? '재고'} 조사를 제출했습니다.`
                          : '재고 조사 기록을 수정했습니다.',
                    { icon: draft ? '📝' : '✅' },
                );
            } else {
                const res = await axios.post('/api/inventory/counts', body, authCfg());
                // 어느 회차로 기록됐는지는 서버가 알려준다. 경계 시각을 넘겨 제출하면 화면이
                // 들고 있던 회차와 실제로 저장된 회차가 다를 수 있다.
                notify(
                    draft
                        ? `${res.data?.slot_label ?? '재고'} 조사를 임시 저장했습니다.`
                        : `${res.data?.slot_label ?? '재고'} 조사를 제출했습니다.`,
                    { icon: draft ? '📝' : '✅' },
                );
            }
            onClose();
        } catch (/** @type {any} */ err) {
            const status = err?.response?.status;
            if (status === 409 || status === 404) {
                // 다른 기기에서 먼저 저장했거나, 이어서 하던 임시 저장이 그사이 제출·삭제됐다.
                notify(`${err.response.data?.message ?? '기록이 바뀌었습니다.'} 최신 기록을 불러옵니다.`, {
                    icon: '⚠️',
                });
                setLoading(true);
                await load();
            } else {
                notify(err?.response?.data?.message || '저장에 실패했습니다.', { icon: '⚠️' });
            }
        } finally {
            setSaving(false);
        }
    };

    /** 저장하지 않은 입력이 있으면 닫기 전에 묻는다. 모르고 닫으면 적은 숫자가 모두 사라진다. */
    const close = async () => {
        if (
            dirty &&
            !(await confirm(
                isFinal
                    ? '고친 내용은 저장되지 않습니다.'
                    : '저장하지 않은 입력은 사라집니다. 자리를 비워야 하면 「임시 저장」을 눌러주세요.',
                {
                    title: '그냥 닫을까요?',
                    confirmText: '그냥 닫기',
                    cancelText: '계속 입력',
                    danger: true,
                },
            ))
        ) {
            return;
        }
        onClose();
    };

    /** 임시 저장을 버리고 지금 회차로 새로 시작한다. 예전 회차에 하다 만 조사가 남아 있을 때 쓴다. */
    const discardDraft = async () => {
        if (!existing?.is_draft) return;
        if (
            !(await confirm('임시 저장한 숫자를 지우고 새로 시작할까요?', {
                confirmText: '지우기',
                danger: true,
            }))
        ) {
            return;
        }
        try {
            await axios.delete(`/api/inventory/counts/${existing.id}`, authCfg());
            notify('임시 저장을 지웠습니다.', { icon: '🗑️' });
        } catch (/** @type {any} */ err) {
            notify(err?.response?.data?.message || '임시 저장을 지우지 못했습니다.', { icon: '⚠️' });
        }
        setLoading(true);
        await load();
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
                .ic-slot.draft { background: var(--warning-bg, #fff3e0); color: var(--warning, #ef6c00); }
                .ic-note { margin: 8px 0 0; font-size: .82rem; color: var(--text-secondary, #888); }
                .ic-note.draft { color: var(--warning, #ef6c00); word-break: keep-all; }
                .ic-link { padding: 0; margin-left: 4px; border: none; background: none; color: inherit; font: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }
                .ic-body { flex: 1; overflow-y: auto; padding: 8px 20px 16px; }

                .ic-group { margin-top: 16px; }
                .ic-group-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
                .ic-group-name { flex-shrink: 0; white-space: nowrap; font-size: .95rem; font-weight: 800; color: var(--text-primary, #333); }
                .ic-group-hint { font-size: .74rem; color: var(--text-secondary, #999); word-break: keep-all; }

                .ic-row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--border-color, #f1f1f1); }
                .ic-name { flex: 1; min-width: 0; font-size: .95rem; color: var(--text-primary, #333); }
                .ic-prev { display: block; font-size: .72rem; color: var(--text-secondary, #aaa); margin-top: 2px; }
                .ic-field { display: flex; align-items: center; gap: 4px; }
                .ic-field input { width: 74px; padding: 9px 8px; font-size: 1rem; text-align: right; border: 1px solid var(--border-color, #ccc); border-radius: 8px; background: var(--bg-color, #fff); color: var(--text-primary, #222); font-family: inherit; box-sizing: border-box; }
                .ic-field input:focus { outline: 2px solid var(--accent, #1a73e8); outline-offset: -1px; }
                .ic-unit { font-size: .8rem; color: var(--text-secondary, #888); min-width: 26px; }
                .ic-field input:disabled { background: var(--border-color, #f0f0f0); color: var(--text-secondary, #888); }
                /* 저울이 넘친 통. 손가락으로 누르는 버튼이라 높이를 입력칸과 맞춘다. */
                .ic-over { box-sizing: border-box; height: 38px; padding: 0 10px; border: 1px solid var(--border-color, #ccc); border-radius: 8px; background: none; color: var(--text-secondary, #888); font-family: inherit; font-size: .82rem; font-weight: 700; cursor: pointer; white-space: nowrap; }
                .ic-over.on { background: var(--warning-bg, #fff3e0); border-color: var(--warning, #ef6c00); color: var(--warning, #ef6c00); }
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
                        {/* 이름이 겹치면(미운영일에 '마감'이 둘 등) 시각을 붙여 구분한다. */}
                        {slotList.map((s, _i, all) => (
                            <span
                                key={s.slot_key}
                                className={`ic-slot ${s.slot_key === slot ? 'now' : ''} ${
                                    slots[s.slot_key] ? (slots[s.slot_key].is_draft ? 'draft' : 'done') : ''
                                }`}
                            >
                                {slotNames(all)(s.slot_key)}
                                {slots[s.slot_key] ? (slots[s.slot_key].is_draft ? ' 임시 저장' : ' 완료') : ''}
                            </span>
                        ))}
                    </div>
                    {offDay && !loading && (
                        <p className="ic-note">
                            오늘은 정해진 조사 회차가 없는 날입니다. 그래도 조사하면 시각에 맞는 회차로 기록됩니다.
                        </p>
                    )}
                    {isFinal && (
                        <p className="ic-note">
                            {existing.counted_by_name}님이 제출했습니다. 고쳐서 다시 저장할 수 있습니다.
                        </p>
                    )}
                    {isDraft && (
                        <p className="ic-note draft">
                            {existing.counted_by_name}님이 {existing.slot_label ?? ''} 조사를 임시 저장해 두었습니다. 빈
                            칸을 모두 채워 제출해야 기록됩니다.
                            <button type="button" className="ic-link" onClick={discardDraft}>
                                지우고 새로 시작
                            </button>
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
                                                        {prev.over_scale
                                                            ? `직전 ${Number(prev.quantity)}${item.count_unit} 넘음`
                                                            : `직전 ${Number(prev.quantity)}${item.count_unit}`}
                                                        {item.measure_mode === 'weight' && prev.spare_count > 0
                                                            ? ` · 미개봉 ${Number(prev.spare_count)}${item.container_unit ?? '통'}`
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
                                                        <span className="ic-unit">{item.container_unit ?? '통'}</span>
                                                    </div>
                                                </div>
                                            )}

                                            <div>
                                                {item.measure_mode === 'weight' && <div className="ic-sub">저울</div>}
                                                <div className="ic-field">
                                                    <input
                                                        inputMode="decimal"
                                                        value={v.quantity}
                                                        disabled={Boolean(v.over)}
                                                        placeholder={v.over ? `${scaleMax} 넘음` : ''}
                                                        onChange={(e) =>
                                                            item.measure_mode === 'weight'
                                                                ? setWeight(item.id, e.target.value)
                                                                : setValue(item.id, 'quantity', e.target.value)
                                                        }
                                                        aria-label={`${item.name} 수량`}
                                                    />
                                                    <span className="ic-unit">{item.count_unit}</span>
                                                    {/* 저울 최대 무게를 넘는 통(거의 가득 찬 통)은 잴 수 없다. */}
                                                    {item.measure_mode === 'weight' && (
                                                        <button
                                                            type="button"
                                                            className={`ic-over ${v.over ? 'on' : ''}`}
                                                            aria-pressed={Boolean(v.over)}
                                                            onClick={() => toggleOver(item.id)}
                                                        >
                                                            넘침
                                                        </button>
                                                    )}
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
                                                {item.measure_mode === 'weight' && v.over
                                                    ? item.tare_g != null
                                                        ? `순 ${Math.max(0, Math.round(scaleMax - Number(item.tare_g))).toLocaleString()}g 이상`
                                                        : `${scaleMax.toLocaleString()}g 이상`
                                                    : ''}
                                                {item.measure_mode === 'weight' &&
                                                !v.over &&
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
                            onChange={(e) => {
                                setDirty(true);
                                setMemo(e.target.value);
                            }}
                        />
                    )}
                </div>

                <div className="ic-foot">
                    <span className="ic-count">{items.length > 0 && `${filledCount} / ${items.length}`}</span>
                    <button className="ic-btn ghost" onClick={close}>
                        닫기
                    </button>
                    {/* 빈 칸이 있으면 임시 저장, 다 채우면 제출. 누르기 전에 어느 쪽인지 버튼에서 보인다. */}
                    <button
                        className="ic-btn primary"
                        onClick={submit}
                        disabled={saving || loading || items.length === 0}
                    >
                        {saving ? '저장 중…' : isFinal ? '수정 저장' : complete ? '제출' : '임시 저장'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default InventoryCount;
