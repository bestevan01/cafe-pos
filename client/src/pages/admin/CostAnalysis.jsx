import { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import ThemeToggle from '../../components/ThemeToggle';
import { useNotification } from '../../hooks/useNotification';
import StatsLayout from '../../components/stats/StatsLayout';
import StatCard from '../../components/stats/StatCard';
import BarList from '../../components/stats/BarList';
import Button from '../../components/ui/Button';

const UNITS = ['g', 'ml', '개'];
const CATEGORIES = ['식재료', '부자재']; // 부자재 = 컵/빨대/뚜껑 등 포장재
const won = (n) => Math.round(Number(n) || 0).toLocaleString();
const catOf = (ing) => (CATEGORIES.includes(ing.category) ? ing.category : '식재료');
const unitLabel = (u) => (u === 'ea' ? '개' : u); // 레거시 'ea' 표시 보정
// 단위당 원가(원/단위). 구매 용량 0 이하이면 0.
const unitCostOf = (ing) => {
    const amount = Number(ing.purchase_amount);
    return amount > 0 ? Number(ing.purchase_price) / amount : 0;
};

/**
 * @param {object} props
 * @param {() => void} props.onBack
 */
function CostAnalysis({ onBack }) {
    const { notify, confirm } = useNotification();
    const [ingredients, setIngredients] = useState([]);
    const [menus, setMenus] = useState([]); // [{menu_id, name, price, cost_override, items:[{ingredient_id, amount}]}]
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState('analysis'); // 'analysis'(기본) | 'ingredients' | 'recipes'

    const [selectedMenuId, setSelectedMenuId] = useState(null);
    const [draftAmounts, setDraftAmounts] = useState({}); // {ingredient_id: '값'}
    const [overrideOn, setOverrideOn] = useState(false);
    const [overrideValue, setOverrideValue] = useState('');
    const [newIng, setNewIng] = useState({
        name: '',
        purchase_price: '',
        purchase_amount: '',
        unit: 'g',
        category: '식재료',
    });

    const auth = useMemo(() => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }), []);

    const fetchAll = useCallback(async () => {
        try {
            const [ingRes, recRes] = await Promise.all([
                axios.get('/api/admin/ingredients', auth),
                axios.get('/api/admin/recipes', auth),
            ]);
            setIngredients(ingRes.data);
            setMenus(recRes.data);
        } catch (/** @type {any} */ err) {
            console.error(err);
            notify('원가 데이터를 불러오지 못했습니다.', { icon: '⚠️' });
        } finally {
            setLoading(false);
        }
    }, [auth, notify]);

    useEffect(() => {
        // fetchAll은 useCallback으로 메모이즈된 비동기 함수라 setState가 await 이후에만 일어남(effect 본문에서 동기 호출 아님) — 규칙 오탐.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void fetchAll();
    }, [fetchAll]);

    // 단위당 원가 맵 (ingredient_id → 원/단위)
    const unitCostMap = useMemo(() => new Map(ingredients.map((i) => [i.id, unitCostOf(i)])), [ingredients]);

    const recipeCostOf = useCallback(
        (menu) =>
            Math.round(
                (menu.items || []).reduce(
                    (s, it) => s + Number(it.amount) * (unitCostMap.get(it.ingredient_id) || 0),
                    0,
                ),
            ),
        [unitCostMap],
    );

    const effectiveCostOf = useCallback(
        (menu) => (menu.cost_override != null ? Number(menu.cost_override) : recipeCostOf(menu)),
        [recipeCostOf],
    );

    // ---- 분석 행 (마진 테이블/그래프용) ----
    const analysis = useMemo(
        () =>
            menus.map((m) => {
                const recipeCost = recipeCostOf(m);
                const cost = effectiveCostOf(m);
                const profit = m.price - cost;
                return {
                    ...m,
                    recipeCost,
                    cost,
                    profit,
                    margin: m.price > 0 ? profit / m.price : 0,
                    manual: m.cost_override != null,
                    hasRecipe: (m.items || []).length > 0,
                };
            }),
        [menus, recipeCostOf, effectiveCostOf],
    );

    const profitRanking = useMemo(() => analysis.slice().sort((a, b) => b.profit - a.profit), [analysis]);

    const avgMargin = useMemo(() => {
        const totalPrice = analysis.reduce((s, r) => s + r.price, 0);
        const totalCost = analysis.reduce((s, r) => s + r.cost, 0);
        return totalPrice > 0 ? (totalPrice - totalCost) / totalPrice : 0;
    }, [analysis]);

    // ---- 메뉴 선택 → 레시피 편집 초안 세팅 ----
    const selectMenu = (menu) => {
        setSelectedMenuId(menu.menu_id);
        const draft = {};
        for (const it of menu.items || []) draft[it.ingredient_id] = String(it.amount);
        setDraftAmounts(draft);
        setOverrideOn(menu.cost_override != null);
        setOverrideValue(menu.cost_override != null ? String(menu.cost_override) : '');
    };

    const selectedMenu = menus.find((m) => m.menu_id === selectedMenuId) || null;

    // 편집 중인 레시피의 실시간 원가
    const draftCost = useMemo(
        () => Math.round(ingredients.reduce((s, ing) => s + (Number(draftAmounts[ing.id]) || 0) * unitCostOf(ing), 0)),
        [draftAmounts, ingredients],
    );

    // 분류별 원가 합계 (편집기 하단에 식재료/부자재 분해 표시)
    const draftCostByCat = useMemo(() => {
        const out = { 식재료: 0, 부자재: 0 };
        for (const ing of ingredients) {
            out[catOf(ing)] += (Number(draftAmounts[ing.id]) || 0) * unitCostOf(ing);
        }
        return { 식재료: Math.round(out['식재료']), 부자재: Math.round(out['부자재']) };
    }, [draftAmounts, ingredients]);

    // 분류별로 묶은 원재료 (비어있는 분류는 제외)
    const ingredientsByCategory = useMemo(
        () =>
            CATEGORIES.map((c) => ({ category: c, items: ingredients.filter((i) => catOf(i) === c) })).filter(
                (g) => g.items.length > 0,
            ),
        [ingredients],
    );

    // ---- 원재료 CRUD ----
    const addIngredient = async () => {
        const { name, purchase_price, purchase_amount, unit } = newIng;
        if (!name.trim() || !(Number(purchase_amount) > 0) || !(Number(purchase_price) >= 0)) {
            notify('이름·가격·용량을 올바르게 입력하세요.', { icon: '⚠️' });
            return;
        }
        try {
            await axios.post(
                '/api/admin/ingredients',
                {
                    name: name.trim(),
                    purchase_price: Number(purchase_price),
                    purchase_amount: Number(purchase_amount),
                    unit,
                    category: newIng.category,
                },
                auth,
            );
            setNewIng({ name: '', purchase_price: '', purchase_amount: '', unit: 'g', category: newIng.category });
            notify('원재료를 추가했습니다.', { icon: '✅' });
            await fetchAll();
        } catch (/** @type {any} */ err) {
            console.error(err);
            notify('원재료 추가에 실패했습니다.', { icon: '⚠️' });
        }
    };

    // 행 입력값을 로컬에서 즉시 반영
    const editIngredientField = (id, field, value) => {
        setIngredients((prev) => prev.map((i) => (i.id === id ? { ...i, [field]: value } : i)));
    };

    // 행을 서버에 저장 (blur 시)
    const saveIngredient = async (ing) => {
        if (!ing.name?.trim() || !(Number(ing.purchase_amount) > 0) || !(Number(ing.purchase_price) >= 0)) {
            notify('값이 올바르지 않습니다. 다시 확인하세요.', { icon: '⚠️' });
            return;
        }
        try {
            await axios.patch(
                `/api/admin/ingredients/${ing.id}`,
                {
                    name: ing.name.trim(),
                    purchase_price: Number(ing.purchase_price),
                    purchase_amount: Number(ing.purchase_amount),
                    unit: ing.unit,
                    category: catOf(ing),
                },
                auth,
            );
            await fetchAll();
        } catch (/** @type {any} */ err) {
            console.error(err);
            notify('원재료 저장에 실패했습니다.', { icon: '⚠️' });
        }
    };

    const deleteIngredient = async (ing) => {
        const ok = await confirm(`'${ing.name}' 원재료를 삭제하면 이 재료가 들어간 레시피에서도 함께 제거됩니다.`, {
            title: '원재료 삭제',
            confirmText: '삭제',
            danger: true,
        });
        if (!ok) return;
        try {
            await axios.delete(`/api/admin/ingredients/${ing.id}`, auth);
            notify('삭제했습니다.', { icon: '🗑️' });
            await fetchAll();
        } catch (/** @type {any} */ err) {
            console.error(err);
            notify('삭제에 실패했습니다.', { icon: '⚠️' });
        }
    };

    // ---- 레시피 + 수동원가 저장 ----
    const saveRecipe = async () => {
        if (!selectedMenu) return;
        const items = ingredients
            .map((ing) => ({ ingredient_id: ing.id, amount: Number(draftAmounts[ing.id]) || 0 }))
            .filter((it) => it.amount > 0);
        try {
            await axios.put(`/api/admin/recipes/${selectedMenu.menu_id}`, { items }, auth);
            await axios.patch(
                `/api/admin/menu/${selectedMenu.menu_id}/cost-override`,
                {
                    cost_override: overrideOn ? Number(overrideValue) || 0 : null,
                },
                auth,
            );
            notify(`'${selectedMenu.name}' 레시피를 저장했습니다.`, { icon: '✅' });
            await fetchAll();
        } catch (/** @type {any} */ err) {
            console.error(err);
            notify('레시피 저장에 실패했습니다.', { icon: '⚠️' });
        }
    };

    const styleTag = (
        <style>{`
                .cost-table-wrap { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
                .cost-table { width: 100%; border-collapse: collapse; font-size: .92rem; }
                .cost-table th, .cost-table td { padding: 10px 8px; border-bottom: 1px solid var(--border-color, #eee); text-align: right; white-space: nowrap; }
                .cost-table th { color: var(--text-secondary, #888); font-weight: 700; font-size: .82rem; }
                .cost-table td.l, .cost-table th.l { text-align: left; }
                .cost-input { width: 92px; min-width: 0; padding: 6px 8px; border: 1px solid var(--border-color, #ddd); border-radius: 8px; background: var(--bg-color, #fff); color: var(--text-primary, #222); text-align: right; box-sizing: border-box; }
                .cost-input.name { width: 130px; text-align: left; }
                .cost-input.unit { width: 64px; text-align: center; }
                .cost-input.cat { width: 86px; text-align: center; }
                .cost-unitcost { color: var(--text-secondary, #777); font-weight: 700; }
                .cost-nav { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
                .menu-pills { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
                .menu-pill { padding: 8px 14px; border-radius: 999px; border: 1px solid var(--border-color, #ddd); background: var(--bg-color, #f7f7f7); color: var(--text-primary, #333); font-weight: 700; cursor: pointer; font-size: .9rem; transition: all .15s ease; }
                .menu-pill.active { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
                .recipe-group { margin-bottom: 18px; }
                .recipe-group-head { font-size: .9rem; font-weight: 800; color: var(--text-secondary, #777); margin: 0 0 10px; padding-bottom: 6px; border-bottom: 1px dashed var(--border-color, #e3e3e3); }
                /* 입력 칸을 고정 폭으로(=auto가 input 본질너비로 부풀어 이름 칸을 찌부시키는 문제 방지) */
                .recipe-grid { display: grid; grid-template-columns: minmax(0, 1fr) 132px; gap: 10px 14px; align-items: center; }
                .recipe-name { color: var(--text-primary, #333); font-weight: 600; word-break: keep-all; }
                .recipe-sub { color: var(--text-secondary, #999); font-weight: 600; font-size: .8rem; margin-left: 6px; }
                .cost-summary { display: flex; flex-wrap: wrap; gap: 22px; margin: 4px 0 20px; }
                .cost-summary .item { display: flex; flex-direction: column; gap: 3px; }
                .cost-summary .k { font-size: .82rem; color: var(--text-secondary, #888); font-weight: 600; }
                .cost-summary .v { font-size: 1.5rem; font-weight: 800; color: var(--text-primary, #222); }
                .badge { display: inline-block; font-size: .7rem; font-weight: 800; padding: 2px 7px; border-radius: 6px; margin-left: 6px; vertical-align: middle; }
                .badge.manual { background: #ede7f6; color: #6a1b9a; }
                .badge.norecipe { background: var(--warning-bg); color: var(--warning); }
                .pos { color: #2e7d32; font-weight: 800; }
                .neg { color: #c62828; font-weight: 800; }
                .editor-foot { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--border-color, #eee); flex-wrap: wrap; }
                .override-row { display: flex; align-items: center; gap: 8px; color: var(--text-secondary, #777); font-size: .88rem; }
                .hint { color: var(--text-secondary, #999); font-size: .85rem; line-height: 1.5; }
            `}</style>
    );

    // 분석 화면 우측 상단: 편집 탭으로 이동하는 버튼들
    const navActions = (
        <div className="cost-nav">
            <ThemeToggle />
            <Button variant="secondary" icon="🧺" onClick={() => setView('ingredients')}>
                원재료 관리
            </Button>
            <Button variant="secondary" icon="📝" onClick={() => setView('recipes')}>
                레시피 수정
            </Button>
        </div>
    );

    const ingredientsCard = (
        <StatCard
            title="원재료 관리"
            icon="🧺"
            loading={loading}
            wide
            subtitle={ingredients.length > 0 ? `${ingredients.length}개 품목` : null}
        >
            <div className="cost-table-wrap">
                <table className="cost-table">
                    <thead>
                        <tr>
                            <th className="l">원재료</th>
                            <th>분류</th>
                            <th>구매가격(원)</th>
                            <th>구매용량</th>
                            <th>단위</th>
                            <th>단위당 원가</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {ingredients.map((ing) => (
                            <tr key={ing.id}>
                                <td className="l">
                                    <input
                                        className="cost-input name"
                                        value={ing.name}
                                        onChange={(e) => editIngredientField(ing.id, 'name', e.target.value)}
                                        onBlur={() => saveIngredient(ing)}
                                    />
                                </td>
                                <td>
                                    <select
                                        className="cost-input cat"
                                        value={catOf(ing)}
                                        onChange={(e) => editIngredientField(ing.id, 'category', e.target.value)}
                                        onBlur={() => saveIngredient(ing)}
                                    >
                                        {CATEGORIES.map((c) => (
                                            <option key={c} value={c}>
                                                {c}
                                            </option>
                                        ))}
                                    </select>
                                </td>
                                <td>
                                    <input
                                        className="cost-input"
                                        type="number"
                                        value={ing.purchase_price}
                                        onChange={(e) => editIngredientField(ing.id, 'purchase_price', e.target.value)}
                                        onBlur={() => saveIngredient(ing)}
                                    />
                                </td>
                                <td>
                                    <input
                                        className="cost-input"
                                        type="number"
                                        value={ing.purchase_amount}
                                        onChange={(e) => editIngredientField(ing.id, 'purchase_amount', e.target.value)}
                                        onBlur={() => saveIngredient(ing)}
                                    />
                                </td>
                                <td>
                                    <select
                                        className="cost-input unit"
                                        value={UNITS.includes(ing.unit) ? ing.unit : '개'}
                                        onChange={(e) => {
                                            editIngredientField(ing.id, 'unit', e.target.value);
                                        }}
                                        onBlur={() => saveIngredient(ing)}
                                    >
                                        {UNITS.map((u) => (
                                            <option key={u} value={u}>
                                                {u}
                                            </option>
                                        ))}
                                    </select>
                                </td>
                                <td className="cost-unitcost">
                                    {unitCostOf(ing).toLocaleString(undefined, { maximumFractionDigits: 2 })} 원/
                                    {unitLabel(ing.unit)}
                                </td>
                                <td>
                                    <Button variant="danger" size="sm" onClick={() => deleteIngredient(ing)}>
                                        삭제
                                    </Button>
                                </td>
                            </tr>
                        ))}
                        {/* 추가 행 */}
                        <tr>
                            <td className="l">
                                <input
                                    className="cost-input name"
                                    placeholder="예: 원두, 일반컵"
                                    value={newIng.name}
                                    onChange={(e) => setNewIng({ ...newIng, name: e.target.value })}
                                />
                            </td>
                            <td>
                                <select
                                    className="cost-input cat"
                                    value={newIng.category}
                                    onChange={(e) => setNewIng({ ...newIng, category: e.target.value })}
                                >
                                    {CATEGORIES.map((c) => (
                                        <option key={c} value={c}>
                                            {c}
                                        </option>
                                    ))}
                                </select>
                            </td>
                            <td>
                                <input
                                    className="cost-input"
                                    type="number"
                                    placeholder="20000"
                                    value={newIng.purchase_price}
                                    onChange={(e) => setNewIng({ ...newIng, purchase_price: e.target.value })}
                                />
                            </td>
                            <td>
                                <input
                                    className="cost-input"
                                    type="number"
                                    placeholder="1000"
                                    value={newIng.purchase_amount}
                                    onChange={(e) => setNewIng({ ...newIng, purchase_amount: e.target.value })}
                                />
                            </td>
                            <td>
                                <select
                                    className="cost-input unit"
                                    value={newIng.unit}
                                    onChange={(e) => setNewIng({ ...newIng, unit: e.target.value })}
                                >
                                    {UNITS.map((u) => (
                                        <option key={u} value={u}>
                                            {u}
                                        </option>
                                    ))}
                                </select>
                            </td>
                            <td className="cost-unitcost">—</td>
                            <td>
                                <Button size="sm" onClick={addIngredient}>
                                    추가
                                </Button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p className="hint" style={{ marginTop: 12 }}>
                값을 고치면 칸을 벗어날 때 자동 저장됩니다. 단위당 원가 = 구매가격 ÷ 구매용량.
                <br />
                컵·빨대·뚜껑 같은 <b>포장재</b>는 분류를 <b>‘부자재’</b>, 단위를 <b>‘개’</b>로 등록하면 한 잔 원가에
                함께 반영됩니다.
            </p>
        </StatCard>
    );

    const recipeCard = (
        <StatCard
            title="메뉴별 레시피"
            icon="📝"
            loading={loading}
            wide
            subtitle="메뉴를 고르고 한 잔에 쓰는 양을 입력하세요"
        >
            {menus.length === 0 ? (
                <p className="hint">등록된 메뉴가 없습니다.</p>
            ) : (
                <>
                    <div className="menu-pills">
                        {menus.map((m) => (
                            <button
                                key={m.menu_id}
                                className={`menu-pill ${selectedMenuId === m.menu_id ? 'active' : ''}`}
                                onClick={() => selectMenu(m)}
                            >
                                {m.name}
                            </button>
                        ))}
                    </div>

                    {!selectedMenu ? (
                        <p className="hint">위에서 메뉴를 선택하면 레시피를 편집할 수 있습니다.</p>
                    ) : ingredients.length === 0 ? (
                        <p className="hint">먼저 ‘원재료 관리’ 탭에서 원재료를 등록하세요.</p>
                    ) : (
                        <>
                            {ingredientsByCategory.map((group) => (
                                <div key={group.category} className="recipe-group">
                                    <div className="recipe-group-head">
                                        {group.category === '부자재' ? '📦 부자재' : '🥤 식재료'}
                                    </div>
                                    <div className="recipe-grid">
                                        {group.items.map((ing) => (
                                            <div key={ing.id} style={{ display: 'contents' }}>
                                                <div className="recipe-name">
                                                    {ing.name}
                                                    <span className="recipe-sub">
                                                        {unitCostOf(ing).toLocaleString(undefined, {
                                                            maximumFractionDigits: 2,
                                                        })}{' '}
                                                        원/{unitLabel(ing.unit)}
                                                    </span>
                                                </div>
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 8,
                                                        justifyContent: 'flex-end',
                                                    }}
                                                >
                                                    <input
                                                        className="cost-input"
                                                        type="number"
                                                        min="0"
                                                        placeholder="0"
                                                        value={draftAmounts[ing.id] ?? ''}
                                                        onChange={(e) =>
                                                            setDraftAmounts({
                                                                ...draftAmounts,
                                                                [ing.id]: e.target.value,
                                                            })
                                                        }
                                                    />
                                                    <span
                                                        style={{
                                                            color: 'var(--text-secondary,#999)',
                                                            width: 24,
                                                        }}
                                                    >
                                                        {unitLabel(ing.unit)}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}

                            <div className="editor-foot">
                                <div className="override-row">
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                                        <input
                                            type="checkbox"
                                            checked={overrideOn}
                                            onChange={(e) => setOverrideOn(e.target.checked)}
                                        />
                                        수동 원가 사용
                                    </label>
                                    {overrideOn && (
                                        <input
                                            className="cost-input"
                                            type="number"
                                            placeholder="직접 입력"
                                            value={overrideValue}
                                            onChange={(e) => setOverrideValue(e.target.value)}
                                        />
                                    )}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                    <span className="hint">
                                        한 잔 원가{' '}
                                        <b style={{ color: 'var(--text-primary,#222)', fontSize: '1.1rem' }}>
                                            {overrideOn ? won(overrideValue) : won(draftCost)}원
                                        </b>{' '}
                                        <span className="recipe-sub">
                                            (식재료 {won(draftCostByCat['식재료'])} · 부자재{' '}
                                            {won(draftCostByCat['부자재'])})
                                        </span>
                                        {overrideOn && (
                                            <span className="recipe-sub">
                                                · 수동값 사용(레시피 계산: {won(draftCost)}원)
                                            </span>
                                        )}
                                        {' · '}순익{' '}
                                        <b
                                            className={
                                                selectedMenu.price -
                                                    (overrideOn ? Number(overrideValue) || 0 : draftCost) >=
                                                0
                                                    ? 'pos'
                                                    : 'neg'
                                            }
                                        >
                                            {won(
                                                selectedMenu.price -
                                                    (overrideOn ? Number(overrideValue) || 0 : draftCost),
                                            )}
                                            원
                                        </b>
                                    </span>
                                    <Button onClick={saveRecipe}>저장</Button>
                                </div>
                            </div>
                        </>
                    )}
                </>
            )}
        </StatCard>
    );

    const analysisCard = (
        <StatCard
            title="메뉴별 마진"
            icon="📊"
            loading={loading}
            wide
            subtitle={analysis.length > 0 ? `평균 마진율 ${(avgMargin * 100).toFixed(0)}%` : null}
        >
            <div className="cost-summary">
                <div className="item">
                    <span className="k">평균 마진율</span>
                    <span className="v">{(avgMargin * 100).toFixed(0)}%</span>
                </div>
                {profitRanking[0] && (
                    <div className="item">
                        <span className="k">잔당 순익 1위</span>
                        <span className="v">
                            {profitRanking[0].name} · {won(profitRanking[0].profit)}원
                        </span>
                    </div>
                )}
            </div>

            <div className="cost-table-wrap" style={{ marginBottom: 24 }}>
                <table className="cost-table">
                    <thead>
                        <tr>
                            <th className="l">메뉴</th>
                            <th>판매가</th>
                            <th>원가</th>
                            <th>잔당 순익</th>
                            <th>마진율</th>
                        </tr>
                    </thead>
                    <tbody>
                        {analysis.map((r) => (
                            <tr key={r.menu_id}>
                                <td className="l">
                                    {r.name}
                                    {r.manual && <span className="badge manual">수동</span>}
                                    {!r.manual && !r.hasRecipe && <span className="badge norecipe">레시피 없음</span>}
                                </td>
                                <td>{won(r.price)}</td>
                                <td>{won(r.cost)}</td>
                                <td className={r.profit >= 0 ? 'pos' : 'neg'}>{won(r.profit)}</td>
                                <td className={r.profit >= 0 ? 'pos' : 'neg'}>{(r.margin * 100).toFixed(0)}%</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <BarList
                data={profitRanking}
                label={(r) => r.name}
                value={(r) => r.profit}
                sublabel={(r) => `${won(r.profit)}원 · 마진 ${(r.margin * 100).toFixed(0)}%`}
                highlightTop={3}
            />
        </StatCard>
    );

    // 원재료 관리 탭
    if (view === 'ingredients') {
        return (
            <StatsLayout title="🧺 원재료 관리" onBack={() => setView('analysis')} actions={<ThemeToggle />}>
                {styleTag}
                {ingredientsCard}
            </StatsLayout>
        );
    }

    // 메뉴별 레시피 탭
    if (view === 'recipes') {
        return (
            <StatsLayout title="📝 메뉴별 레시피" onBack={() => setView('analysis')} actions={<ThemeToggle />}>
                {styleTag}
                {recipeCard}
            </StatsLayout>
        );
    }

    // 기본: 원가·순익 분석(통계) — 우측 상단 버튼으로 편집 탭 이동
    return (
        <StatsLayout title="💰 원가 · 순익 분석" onBack={onBack} actions={navActions}>
            {styleTag}
            {analysisCard}
        </StatsLayout>
    );
}

export default CostAnalysis;
