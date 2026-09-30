import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import StatsLayout from '../../components/stats/StatsLayout';
import StatCard from '../../components/stats/StatCard';
import AdminUserMenu from '../../components/AdminUserMenu';
import { useNotification } from '../../hooks/useNotification';
import { useDragSort } from '../../hooks/useDragSort';
import SlotSchedule from '../../components/SlotSchedule';

const MODES = [
    {
        key: 'pack',
        label: '봉·줄로 세는 것',
        hint: '직원은 「안 뜯은 개수 + 뜯어 쓰는 것의 남은 비율」을 하나의 숫자로 적습니다(2봉 + 30% → 2.3). 한 봉이 몇 개인지 적어두면 개수로도 함께 보여줍니다. 빨대처럼 봉마다 개수가 다르면 비워두세요 — 틀린 환산을 보여주느니 안 보여주는 편이 낫습니다.',
    },
    { key: 'each', label: '냉장고', hint: '냉장고 안의 개수를 낱개로 셉니다.' },
    {
        key: 'weight',
        label: '저울',
        hint: '미개봉 개수를 세고, 쓰고 있는 용기는 통째로 저울에 올린 무게에서 빈 용기 무게를 뺍니다. 용기 이름(통·봉 등)을 고르면 직원 화면에도 그 이름으로 나옵니다. 빈 용기 무게는 다 쓴 용기를 세척·건조한 뒤 재서 넣으면, 그동안 쌓인 기록의 실제 양도 함께 드러납니다.',
    },
];

/**
 * 한 측정 방식의 품목 카드.
 *
 * 카드마다 따로 컴포넌트인 이유는 드래그 훅 때문이다. 훅은 목록 하나를 맡으므로,
 * 세 묶음을 한 훅으로 다루면 끌던 행이 어느 묶음 것인지 알 수 없다.
 *
 * @param {object} props
 * @param {{key: string, label: string, hint: string}} props.mode
 * @param {any[]} props.list
 * @param {any[]} props.units
 * @param {boolean} props.loading
 * @param {(item: any, field: string, value: any) => void} props.patch
 * @param {(item: any, field: string, raw: string) => void} props.patchNumber
 * @param {(item: any) => void} props.retire
 * @param {(mode: string, from: number, to: number) => void} props.onReorder
 * @param {(mode: string) => void} props.onCommit
 * @param {number} props.scaleMax  매장 저울 최대 무게(g). 저울 품목 카드에서만 쓴다
 * @param {number} props.scaleRev  바뀌면 저울 최대 무게 입력칸을 다시 그린다(저장 실패 시 되돌리기)
 * @param {(raw: string) => void} props.onScaleMax
 */
function ModeCard({
    mode,
    list,
    units,
    loading,
    patch,
    patchNumber,
    retire,
    onReorder,
    onCommit,
    scaleMax,
    scaleRev,
    onScaleMax,
}) {
    // 순서는 부모가 들고 있는다. 여기서 사본을 두면 부모 목록과 어긋날 수 있다.
    // 드래그 effect가 옛 클로저를 붙잡지 않도록 콜백만 ref로 최신화한다(위생 점검과 같은 방식).
    const cbRef = useRef({ onReorder, onCommit });
    useEffect(() => {
        cbRef.current = { onReorder, onCommit };
    });

    // 위생 점검 체크리스트·메뉴 관리와 같은 훅이라 세 화면의 조작감이 같다.
    const { dragId, dragStart } = useDragSort({
        onReorder: (from, to) => cbRef.current.onReorder(mode.key, from, to),
        onCommit: () => cbRef.current.onCommit(mode.key),
    });
    const order = list;

    return (
        <StatCard title={mode.label} icon="📦" wide loading={loading} subtitle={`${order.length}개`}>
            <p className="ii-hint">{mode.hint}</p>
            {mode.key === 'weight' && (
                <div className="ii-scale">
                    <span className="ii-field">
                        저울 최대 무게
                        <input
                            key={`${scaleMax}-${scaleRev}`}
                            defaultValue={scaleMax}
                            onBlur={(e) => onScaleMax(e.target.value)}
                            aria-label="저울 최대 무게"
                        />
                        g
                    </span>
                    <span className="ii-hint">
                        이보다 무거운 용기(거의 가득 찬 것)는 직원이 「넘침」으로 기록하고, 앱은 &lsquo;○g
                        이상&rsquo;으로 봅니다. 주문 기준은 저울로 잴 수 있는 양(저울 최대 무게 − 빈 용기 무게)보다 낮게
                        잡아야 판단할 수 있습니다.
                    </span>
                </div>
            )}
            {/* useDragSort의 마크업 약속: 목록에 data-drag-list, 행에 data-drag-row + data-drag-id.
                하나라도 빠지면 손잡이를 잡아도 아무 일도 일어나지 않는다. */}
            <div data-drag-list>
                {order.map((item, idx) => (
                    <div
                        className={`ii-row ${dragId === item.id ? 'dragging' : ''}`}
                        key={item.id}
                        data-drag-row
                        data-drag-id={item.id}
                    >
                        <button
                            className="ii-grip"
                            onPointerDown={(e) => dragStart(e, idx, item.id)}
                            aria-label={`${item.name} 순서 바꾸기`}
                        >
                            ⠿
                        </button>
                        <span className="ii-name">{item.name}</span>

                        {mode.key !== 'weight' && (
                            <span className="ii-field">
                                1
                                <select
                                    value={item.count_unit}
                                    onChange={(e) => patch(item, 'count_unit', e.target.value)}
                                    aria-label={`${item.name} 세는 단위`}
                                >
                                    {/* 목록에 없는 값이 이미 들어 있을 수 있다(단위를 지운 뒤 등).
                                    그대로 두면 select가 첫 항목으로 튀어 조용히 바뀌므로 함께 싣는다. */}
                                    {!units.some((u) => u.name === item.count_unit) && (
                                        <option value={item.count_unit}>{item.count_unit}</option>
                                    )}
                                    {units.map((u) => (
                                        <option key={u.id} value={u.name}>
                                            {u.name}
                                        </option>
                                    ))}
                                </select>
                                =
                                <input
                                    defaultValue={item.count_per_pack == null ? '' : Number(item.count_per_pack)}
                                    placeholder="일정하지 않음"
                                    onBlur={(e) => patchNumber(item, 'count_per_pack', e.target.value)}
                                    aria-label={`${item.name} 한 팩의 양`}
                                />
                                {item.count_per_pack == null ? '' : item.base_unit}
                            </span>
                        )}

                        {mode.key === 'weight' && (
                            <>
                                {/* 용기 이름. 원두처럼 봉지인 품목이 '미개봉 4통'으로 보이면 헷갈린다. */}
                                <span className="ii-field">
                                    용기
                                    <select
                                        value={item.container_unit ?? '통'}
                                        onChange={(e) => patch(item, 'container_unit', e.target.value)}
                                        aria-label={`${item.name} 용기 이름`}
                                    >
                                        {!units.some((u) => u.name === (item.container_unit ?? '통')) && (
                                            <option value={item.container_unit ?? '통'}>
                                                {item.container_unit ?? '통'}
                                            </option>
                                        )}
                                        {units.map((u) => (
                                            <option key={u.id} value={u.name}>
                                                {u.name}
                                            </option>
                                        ))}
                                    </select>
                                </span>
                                <span className="ii-field">
                                    빈 {item.container_unit ?? '통'} 무게
                                    <input
                                        defaultValue={item.tare_g == null ? '' : Number(item.tare_g)}
                                        placeholder="아직"
                                        onBlur={(e) => patchNumber(item, 'tare_g', e.target.value)}
                                        aria-label={`${item.name} 빈 용기 무게`}
                                    />
                                    g
                                </span>
                                <span className="ii-field">
                                    가득 찼을 때
                                    <input
                                        defaultValue={Number(item.count_per_pack)}
                                        onBlur={(e) => patchNumber(item, 'count_per_pack', e.target.value)}
                                        aria-label={`${item.name} 가득 찼을 때 내용물`}
                                    />
                                    g
                                </span>
                            </>
                        )}

                        {/* '기준'만 적어두면 이하인지 이상인지 알 수 없다. 문장으로 읽히게 둔다. */}
                        <span className="ii-field alert">
                            <input
                                defaultValue={item.low_threshold == null ? '' : Number(item.low_threshold)}
                                placeholder="안 함"
                                onBlur={(e) => patchNumber(item, 'low_threshold', e.target.value)}
                                aria-label={`${item.name} 주문 알림 기준`}
                            />
                            {mode.key === 'weight' ? 'g' : item.count_unit} 이하면 주문
                        </span>

                        {/* ✕는 지우는 것처럼 보인다. 실제로는 조사 목록에서 빼는 것(기록은 남는다). */}
                        <button className="ii-x" onClick={() => retire(item)}>
                            빼기
                        </button>

                        {/* 저울이 넘치면 '○g 이상'만 안다. 기준이 그보다 높으면 주문이 필요한지 판단할 수 없다.
                            단, 가득 찬 용기(내용물 + 빈 용기)가 저울 최대 무게 안이면 넘칠 일이 없으니 경고하지 않는다
                            (원두 500g + 봉지 28g = 528g처럼). 가득 찼을 때 무게를 모르면 넘칠 수 있다고 본다. */}
                        {mode.key === 'weight' &&
                            item.low_threshold != null &&
                            (item.count_per_pack == null ||
                                Number(item.count_per_pack) + Number(item.tare_g ?? 0) > scaleMax) &&
                            Number(item.low_threshold) >= scaleMax - Number(item.tare_g ?? 0) && (
                                <span className="ii-warn">
                                    ⚠️ 주문 기준이 저울로 잴 수 있는 양(
                                    {Math.max(0, scaleMax - Number(item.tare_g ?? 0)).toLocaleString()}g)보다 높아, 가득
                                    찬 {item.container_unit ?? '통'}은(는) 주문이 필요한지 판단할 수 없습니다. 기준을
                                    낮춰주세요.
                                </span>
                            )}
                    </div>
                ))}
            </div>
            {order.length === 0 && <p className="ii-hint">아직 없습니다.</p>}
        </StatCard>
    );
}

/**
 * 재고 조사 품목 관리.
 *
 * 원가·순익의 '원재료 관리'와는 아무 관계가 없다. 두 매장 모두 원가 분석을 사실상 쓰지
 * 않고, 매입가는 같은 규격이어도 살 때마다 달라져 유지가 부담이라는 피드백을 받았다.
 * 매일 쓰는 재고가 안 쓰는 기능의 데이터 상태에 묶이면 안 되어 품목 테이블을 따로 뒀다.
 *
 * 품목은 매장마다 다르다. 두 매장은 DB가 분리돼 있어 여기서 만든 품목은 그 매장에만 있다
 * (본부동의 '컵홀더(병역)'처럼 한쪽에만 있는 물건이 자연스럽게 다뤄진다).
 *
 * @param {{onBack: () => void}} props
 */
function InventoryItems({ onBack }) {
    const { notify, confirm } = useNotification();
    const [items, setItems] = useState(/** @type {any[]} */ ([]));
    const [units, setUnits] = useState(/** @type {any[]} */ ([]));
    const [loading, setLoading] = useState(true);
    // container: 저울 품목의 용기 이름. 봉·줄 품목의 unit과 따로 둔다(모드를 바꿔도 서로 섞이지 않게).
    const [draft, setDraft] = useState({ name: '', mode: 'pack', unit: '', per: '', base_unit: '개', container: '통' });
    const [newUnit, setNewUnit] = useState('');
    // 매장 저울의 최대 무게(g). 주문 기준이 잴 수 있는 한계보다 높지 않은지 보는 데 쓴다.
    const [scaleMax, setScaleMax] = useState(1000);
    // 저장에 실패하면 입력칸을 원래 값으로 되돌리려고 다시 그린다(입력칸은 defaultValue라 값만 바꿔선 안 바뀐다).
    const [scaleRev, setScaleRev] = useState(0);

    const authCfg = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

    const load = useCallback(async () => {
        try {
            const [itemRes, unitRes, settingRes] = await Promise.all([
                axios.get('/api/admin/inventory/items', authCfg()),
                axios.get('/api/admin/inventory/units', authCfg()),
                axios.get('/api/admin/inventory/settings', authCfg()),
            ]);
            setItems(itemRes.data);
            setUnits(unitRes.data);
            setScaleMax(Number(settingRes.data.scale_max_g) || 1000);
            setDraft((d) => (d.unit ? d : { ...d, unit: unitRes.data[0]?.name ?? '개' }));
        } catch {
            notify('품목을 불러오지 못했습니다.', { icon: '⚠️', dedupeKey: 'load-inv-items' });
        } finally {
            setLoading(false);
        }
    }, [notify]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
    }, [load]);

    /** 저울 최대 무게를 바꾼다. 같은 값이면 보내지 않는다. @param {string} raw */
    const saveScaleMax = async (raw) => {
        const v = Number(String(raw).trim());
        if (v === scaleMax) return;
        try {
            await axios.put('/api/admin/inventory/settings', { scale_max_g: v }, authCfg());
            setScaleMax(v);
            notify(`저울 최대 무게를 ${v.toLocaleString()}g으로 저장했습니다.`, { icon: '✅' });
        } catch (/** @type {any} */ err) {
            setScaleRev((n) => n + 1);
            notify(err?.response?.data?.message || '저울 최대 무게를 저장하지 못했습니다.', { icon: '⚠️' });
        }
    };

    /** 화면을 먼저 바꾸고 보낸다. 실패하면 되돌린다. @param {any} item @param {string} field @param {any} value */
    const patch = async (item, field, value) => {
        const before = items;
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, [field]: value } : i)));
        try {
            await axios.patch(`/api/admin/inventory/items/${item.id}`, { [field]: value }, authCfg());
        } catch (/** @type {any} */ err) {
            setItems(before);
            notify(err?.response?.data?.message || '저장하지 못했습니다.', { icon: '⚠️' });
        }
    };

    /** 숫자 칸. 비우면 null(기준 없음)로 보낸다. @param {any} item @param {string} field @param {string} raw */
    const patchNumber = (item, field, raw) => {
        const v = String(raw).trim();
        if (v === '') return patch(item, field, null);
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) return;
        return patch(item, field, n);
    };

    /** 끌고 있는 동안 화면 순서를 바로 바꾼다. @param {string} mode @param {number} from @param {number} to */
    const reorderWithin = (mode, from, to) => {
        setItems((prev) => {
            const group = prev.filter((i) => i.is_active && i.measure_mode === mode);
            const [moved] = group.splice(from, 1);
            group.splice(to, 0, moved);
            // 그 묶음만 새 순서로 갈아끼우고 나머지는 그대로 둔다.
            let k = 0;
            return prev.map((i) => (i.is_active && i.measure_mode === mode ? group[k++] : i));
        });
    };

    /**
     * 손을 뗐을 때 저장한다. 묶음마다 1부터 다시 매기면 세 묶음의 번호가 겹치므로
     * 항상 전체 순서를 한 번에 보낸다.
     */
    const commitOrder = async () => {
        const merged = MODES.flatMap((m) => items.filter((i) => i.is_active && i.measure_mode === m.key));
        try {
            await axios.put('/api/admin/inventory/items/order', { ids: merged.map((i) => i.id) }, authCfg());
        } catch {
            notify('순서를 저장하지 못했습니다.', { icon: '⚠️', dedupeKey: 'inv-order' });
            void load();
        }
    };

    const add = async () => {
        const name = draft.name.trim();
        if (!name) return notify('품목 이름을 적어주세요.', { icon: '⚠️' });
        const per = Number(draft.per || 1);
        if (!(per > 0)) return notify('한 팩의 양은 0보다 커야 합니다.', { icon: '⚠️' });
        try {
            await axios.post(
                '/api/admin/inventory/items',
                {
                    name,
                    measure_mode: draft.mode,
                    count_unit: draft.mode === 'weight' ? 'g' : draft.unit || '개',
                    ...(draft.mode === 'weight' ? { container_unit: draft.container || '통' } : {}),
                    count_per_pack: per,
                    // 환산해서 보여줄 단위. 저울은 g, 나머지는 낱개가 기본이다.
                    base_unit: draft.mode === 'weight' ? 'g' : draft.base_unit || '개',
                },
                authCfg(),
            );
            setDraft({ ...draft, name: '', per: '' });
            await load();
        } catch (/** @type {any} */ err) {
            notify(err?.response?.data?.message || '품목을 추가하지 못했습니다.', { icon: '⚠️' });
        }
    };

    const addUnit = async () => {
        const name = newUnit.trim();
        if (!name) return;
        try {
            await axios.post('/api/admin/inventory/units', { name }, authCfg());
            setNewUnit('');
            await load();
        } catch (/** @type {any} */ err) {
            notify(err?.response?.data?.message || '단위를 추가하지 못했습니다.', { icon: '⚠️' });
        }
    };

    /** @param {any} unit */
    const removeUnit = async (unit) => {
        try {
            await axios.delete(`/api/admin/inventory/units/${unit.id}`, authCfg());
            await load();
        } catch (/** @type {any} */ err) {
            // 쓰고 있는 단위면 서버가 막는다. 어느 품목이 쓰는지까지 알려준다.
            notify(err?.response?.data?.message || '단위를 지우지 못했습니다.', { icon: '⚠️' });
        }
    };

    /** @param {any} item */
    const retire = async (item) => {
        if (!(await confirm(`"${item.name}"을(를) 조사 목록에서 빼시겠습니까?`, { confirmText: '빼기' }))) return;
        // 지우지 않고 끈다. 지난 조사 기록에 그 품목이 남아 있어야 한다.
        await patch(item, 'is_active', false);
    };

    const counted = items.filter((i) => i.is_active);
    const retired = items.filter((i) => !i.is_active);

    return (
        <StatsLayout title="📋 재고 품목 관리" onBack={onBack} actions={<AdminUserMenu />}>
            <style>{`
                .ii-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--border-color, #f1f1f1); background: var(--card-bg, #fff); }
                .ii-row.dragging { opacity: .5; }
                .ii-grip { flex-shrink: 0; padding: 4px 6px; border: none; background: none; color: var(--text-secondary, #bbb); font-size: 1rem; cursor: grab; touch-action: none; }
                .ii-name { flex: 1; min-width: 120px; font-size: .95rem; font-weight: 600; color: var(--text-primary, #333); }
                .ii-field { display: flex; align-items: center; gap: 4px; font-size: .8rem; color: var(--text-secondary, #888); }
                /* Safari는 select의 위아래 padding을 무시해 입력칸보다 얇아진다 — 높이를 직접 맞춘다 */
                .ii-field input, .ii-field select { box-sizing: border-box; height: 34px; padding: 0 8px; font-size: .85rem; border: 1px solid var(--border-color, #ccc); border-radius: 7px; background: var(--bg-color, #fff); color: var(--text-primary, #222); font-family: inherit; }
                .ii-field input { width: 68px; text-align: right; }
                .ii-field.alert { padding: 3px 8px 3px 4px; border-radius: 999px; background: var(--bg-color, #f7f7f7); }
                .ii-x { box-sizing: border-box; height: 34px; padding: 0 10px; border: 1px solid var(--border-color, #ddd); border-radius: 7px; background: none; color: var(--text-secondary, #999); cursor: pointer; font-size: .8rem; font-family: inherit; }
                .ii-x:hover { color: var(--danger); border-color: var(--danger); }
                .ii-hint { font-size: .78rem; color: var(--text-secondary, #999); margin: 0 0 10px; word-break: keep-all; }
                .ii-add { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding-top: 12px; }
                .ii-add input, .ii-add select { box-sizing: border-box; height: 40px; padding: 0 10px; font-size: .9rem; border: 1px solid var(--border-color, #ccc); border-radius: 8px; background: var(--bg-color, #fff); color: var(--text-primary, #222); font-family: inherit; }
                .ii-add .name { flex: 1; min-width: 140px; }
                .ii-add .small { width: 92px; }
                .ii-btn { box-sizing: border-box; height: 40px; padding: 0 16px; font-size: .9rem; font-weight: 700; border: none; border-radius: 8px; background: var(--accent, #1a73e8); color: #fff; cursor: pointer; font-family: inherit; }
                .ii-units { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 4px; }
                .ii-unit { display: inline-flex; align-items: center; gap: 4px; padding: 5px 6px 5px 12px; border-radius: 999px; background: var(--bg-color, #f2f2f2); color: var(--text-primary, #333); font-size: .88rem; font-weight: 600; }
                .ii-unit button { border: none; background: none; color: var(--text-secondary, #aaa); cursor: pointer; font-size: .8rem; padding: 0 4px; }
                .ii-unit button:hover { color: var(--danger); }
                .ii-mode { font-size: .74rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--bg-color, #f2f2f2); color: var(--text-secondary, #888); }
                .ii-scale { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 0 0 12px; padding: 10px 12px; border-radius: 10px; background: var(--bg-color, #f7f7f7); }
                .ii-scale .ii-hint { flex: 1; min-width: 220px; margin: 0; }
                .ii-warn { flex-basis: 100%; padding-left: 34px; font-size: .78rem; color: var(--warning, #ef6c00); line-height: 1.5; word-break: keep-all; }
                .ii-restore { padding: 6px 10px; font-size: .8rem; border: 1px solid var(--border-color, #ddd); border-radius: 7px; background: none; color: var(--text-secondary, #888); cursor: pointer; font-family: inherit; }
            `}</style>

            {MODES.map((m) => (
                <ModeCard
                    key={m.key}
                    mode={m}
                    list={counted.filter((i) => i.measure_mode === m.key)}
                    units={units}
                    loading={loading}
                    patch={patch}
                    patchNumber={patchNumber}
                    retire={retire}
                    onReorder={reorderWithin}
                    onCommit={commitOrder}
                    scaleMax={scaleMax}
                    scaleRev={scaleRev}
                    onScaleMax={(raw) => void saveScaleMax(raw)}
                />
            ))}

            <StatCard title="품목 추가" icon="➕" wide>
                <div className="ii-add">
                    <input
                        className="name"
                        placeholder="품목 이름 (예: 컵홀더(병역))"
                        value={draft.name}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                    <select value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value })}>
                        {MODES.map((m) => (
                            <option key={m.key} value={m.key}>
                                {m.label}
                            </option>
                        ))}
                    </select>
                    {draft.mode === 'weight' && (
                        <select
                            value={draft.container}
                            onChange={(e) => setDraft({ ...draft, container: e.target.value })}
                            aria-label="용기 이름"
                        >
                            {!units.some((u) => u.name === draft.container) && (
                                <option value={draft.container}>{draft.container}</option>
                            )}
                            {units.map((u) => (
                                <option key={u.id} value={u.name}>
                                    {u.name}
                                </option>
                            ))}
                        </select>
                    )}
                    {draft.mode !== 'weight' && (
                        <select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}>
                            {units.map((u) => (
                                <option key={u.id} value={u.name}>
                                    {u.name}
                                </option>
                            ))}
                        </select>
                    )}
                    <input
                        className="small"
                        placeholder={
                            draft.mode === 'weight'
                                ? `한 ${draft.container || '통'} g`
                                : `1${draft.unit || '단위'}=몇 개`
                        }
                        value={draft.per}
                        onChange={(e) => setDraft({ ...draft, per: e.target.value.replace(/[^0-9.]/g, '') })}
                    />
                    <button className="ii-btn" onClick={add}>
                        추가
                    </button>
                </div>
                <p className="ii-hint">
                    왼쪽부터 <b>이름 · 어디서 세는지 · 세는 단위 · 한 단위가 얼마인지</b> 순입니다. 예를 들어
                    페트컵(기본)을 <b>봉 / 50 / 개</b>로 넣어두면, 직원은 <b>13</b>만 적고 화면에 650개로 나옵니다.
                    품목은 이 매장에만 만들어집니다.
                </p>
            </StatCard>

            {/* 알림 설정(주문 필요·조사 시각)은 여기 두지 않는다. 알림 설정 화면 한 곳에 모았다 —
                두 곳에 있으면 어디서 바꿔야 하는지 헷갈린다. */}
            <SlotSchedule
                endpoint="/api/admin/inventory/slots"
                title="조사 회차"
                work="조사"
                emptyHint="추가하기 전까지는 하루 한 번('조사')으로 기록되고, 조사 시각 알림도 나가지 않습니다."
            />

            <StatCard title="세는 단위" icon="📏" wide subtitle={`${units.length}개`}>
                <p className="ii-hint">
                    품목에서 고를 수 있는 단위입니다. 여기서 정해두면 &lsquo;봉&rsquo;과 &lsquo;봉지&rsquo;가 섞이지
                    않습니다. 1줄이 몇 개인지는 단위가 아니라 품목마다 따로 정합니다 — 같은 &lsquo;줄&rsquo;이어도
                    컵홀더 종류마다 개수가 다르기 때문입니다.
                </p>
                <div className="ii-units">
                    {units.map((u) => (
                        <span className="ii-unit" key={u.id}>
                            {u.name}
                            <button onClick={() => removeUnit(u)} aria-label={`${u.name} 지우기`}>
                                ✕
                            </button>
                        </span>
                    ))}
                </div>
                <div className="ii-add">
                    <input
                        className="small"
                        placeholder="새 단위"
                        value={newUnit}
                        maxLength={10}
                        onChange={(e) => setNewUnit(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addUnit()}
                    />
                    <button className="ii-btn" onClick={addUnit}>
                        추가
                    </button>
                </div>
            </StatCard>

            {retired.length > 0 && (
                <StatCard title="뺀 품목" icon="🗄️" wide subtitle={`${retired.length}개`}>
                    <p className="ii-hint">지난 조사 기록에는 그대로 남아 있습니다.</p>
                    {retired.map((item) => (
                        <div className="ii-row" key={item.id}>
                            <span className="ii-name">{item.name}</span>
                            <button className="ii-restore" onClick={() => patch(item, 'is_active', true)}>
                                되돌리기
                            </button>
                        </div>
                    ))}
                </StatCard>
            )}
        </StatsLayout>
    );
}

export default InventoryItems;
