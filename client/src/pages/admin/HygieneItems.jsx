import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import StatsLayout from '../../components/stats/StatsLayout';
import StatCard from '../../components/stats/StatCard';
import Button from '../../components/ui/Button';
import ThemeToggle from '../../components/ThemeToggle';
import { useNotification } from '../../hooks/useNotification';

// axios에 전역 인증 인터셉터가 없어 호출마다 헤더를 붙인다(다른 관리자 화면과 동일).
// 컴포넌트 밖에 두는 이유: 안에 두면 매 렌더마다 새 함수가 되어 useCallback 의존성이 흔들린다.
const authCfg = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

// 서버(utils/hygieneCategories.js)의 HYGIENE_CATEGORIES와 같은 목록을 유지한다.
// 자유 입력이면 '냉장·냉동'과 '냉장/냉동'처럼 같은 뜻이 갈려 보고서에서 묶이지 않는다.
const CATEGORIES = ['개인위생', '조리·기구', '냉장·냉동', '매장·홀', '폐기물', '기타'];

/**
 * 위생점검 체크리스트 '항목' 편집 화면 (관리자 전용).
 *
 * 직원이 매일 점검할 문구를 관리자가 직접 만든다.
 * 삭제는 소프트 삭제(은퇴)다 — 지난 기록에서 이 항목의 추이를 계속 볼 수 있어야 하기 때문.
 * 문구를 고쳐도 이미 제출된 기록은 바뀌지 않는다(제출 시점 문구가 기록에 복사돼 있다).
 *
 * @param {object} props
 * @param {() => void} props.onBack
 */
function HygieneItems({ onBack }) {
    const [items, setItems] = useState(/** @type {any[]} */ ([]));
    const [loading, setLoading] = useState(true);
    const [draft, setDraft] = useState({ label: '', category: CATEGORIES[0] });
    const [dragId, setDragId] = useState(/** @type {number|null} */ (null));
    const { notify, confirm } = useNotification();

    // 드래그 중에는 최신 items를 클로저가 아니라 ref로 읽는다(포인터 이벤트가 렌더보다 자주 온다).
    const itemsRef = useRef(items);
    useEffect(() => {
        itemsRef.current = items;
    }, [items]);
    const dragRef = useRef(/** @type {{from: number, moved: boolean}|null} */ (null));
    // effect가 dragId에만 의존하도록 saveOrder는 항상 최신값을 ref로 읽는다.
    const saveOrderRef = useRef(/** @type {(next: any[]) => void} */ (() => {}));
    const listRef = useRef(/** @type {HTMLDivElement|null} */ (null));

    const load = useCallback(async () => {
        try {
            const res = await axios.get('/api/admin/hygiene/items', authCfg());
            setItems(res.data);
        } catch {
            notify('항목을 불러오지 못했습니다.', { icon: '⚠️' });
        } finally {
            setLoading(false);
        }
    }, [notify]);

    useEffect(() => {
        // load는 useCallback으로 메모이즈된 비동기 함수라 setState가 await 이후에만 일어남
        // (effect 본문에서 동기 호출이 아니다) — 규칙 오탐. UsersDashboard와 동일한 처리.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
    }, [load]);

    const active = items.filter((i) => i.is_active);
    const retired = items.filter((i) => !i.is_active);

    // 화면에 표시된 순서 그대로 서버에 넘겨 sort_order를 다시 매긴다.
    /** 화면에 보이는 순서 그대로 서버에 넘긴다. 화면 반영은 드래그 중에 이미 끝나 있다. */
    /** @param {any[]} next */
    const saveOrder = async (next) => {
        try {
            await axios.put('/api/admin/hygiene/items/order', { ids: next.map((i) => i.id) }, authCfg());
        } catch {
            notify('순서 저장에 실패했습니다.', { icon: '⚠️' });
            load();
        }
    };

    // 렌더마다 최신 saveOrder를 ref에 담아 둔다(드래그 effect가 옛 클로저를 붙잡지 않도록).
    useEffect(() => {
        saveOrderRef.current = saveOrder;
    });

    // ---- 드래그로 순서 바꾸기 ----
    // HTML5 드래그 앤 드롭 API 대신 포인터 이벤트를 쓴다. HTML5 쪽은 모바일 사파리에서
    // 아예 동작하지 않아, 관리자가 태블릿·폰으로 열면 순서를 못 바꾼다.
    // 손잡이에 touch-action: none을 줘야 터치 드래그가 스크롤에 먹히지 않는다.

    /** @param {import('react').PointerEvent<HTMLElement>} e @param {number} idx @param {number} id */
    const dragStart = (e, idx, id) => {
        e.preventDefault();
        dragRef.current = { from: idx, moved: false };
        setDragId(id);
    };

    // 이동·종료는 손잡이가 아니라 window에서 듣는다.
    // 손잡이가 작아서 끄는 도중 포인터가 금방 벗어나는데, 그때 이벤트가 끊기면 안 된다.
    // setPointerCapture를 쓰지 않는 이유: 캡처가 실패하면 드래그가 아무 표시 없이 죽는다.
    useEffect(() => {
        if (dragId === null) return undefined;

        /** @param {PointerEvent} e */
        const onMove = (e) => {
            const d = dragRef.current;
            if (!d || !listRef.current) return;
            const rows = /** @type {HTMLElement[]} */ ([...listRef.current.querySelectorAll('.hyg-row')]);

            // 포인터가 어느 행의 중간선을 넘었는지로 목표 위치를 정한다.
            let to = rows.findIndex((row) => {
                const b = row.getBoundingClientRect();
                return e.clientY < b.top + b.height / 2;
            });
            if (to === -1) to = rows.length - 1;
            if (to === d.from) return;

            // 끌고 가는 동안 목록을 실제로 재배열해 보여준다(별도 드롭 표시선이 필요 없다).
            const from = d.from;
            setItems((prev) => {
                const act = prev.filter((i) => i.is_active);
                const ret = prev.filter((i) => !i.is_active);
                const [moved] = act.splice(from, 1);
                act.splice(to, 0, moved);
                return [...act, ...ret];
            });
            d.from = to;
            d.moved = true;
        };

        const onEnd = () => {
            const d = dragRef.current;
            dragRef.current = null;
            setDragId(null);
            // 위치가 실제로 바뀐 경우에만 저장한다(그냥 눌렀다 뗀 것까지 PUT을 보내지 않는다).
            if (d?.moved) saveOrderRef.current(itemsRef.current.filter((i) => i.is_active));
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onEnd);
        window.addEventListener('pointercancel', onEnd);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onEnd);
            window.removeEventListener('pointercancel', onEnd);
        };
    }, [dragId]);

    /** @param {number} id @param {'label'|'category'} field @param {string} value */
    const editField = (id, field, value) => {
        setItems(items.map((i) => (i.id === id ? { ...i, [field]: value } : i)));
    };

    /** 값이 실제로 바뀌었을 때만 저장한다(칸을 그냥 지나가도 매번 PATCH가 나가는 것을 막는다). */
    /** @param {any} item @param {'label'|'category'} field */
    const saveField = async (item, field) => {
        const value = String(item[field] ?? '').trim();
        if (!value && field === 'label') {
            notify('점검 문구는 비울 수 없습니다.', { icon: '⚠️' });
            return load();
        }
        try {
            await axios.patch(`/api/admin/hygiene/items/${item.id}`, { [field]: value }, authCfg());
        } catch {
            notify('저장에 실패했습니다.', { icon: '⚠️' });
            load();
        }
    };

    const addItem = async () => {
        const label = draft.label.trim();
        if (!label) return notify('점검 문구를 입력하세요.', { icon: '⚠️' });
        try {
            await axios.post('/api/admin/hygiene/items', { label, category: draft.category }, authCfg());
            setDraft({ label: '', category: draft.category }); // 분류는 남겨둔다 — 같은 묶음을 연달아 넣는 경우가 많다
            load();
        } catch {
            notify('항목 추가에 실패했습니다.', { icon: '⚠️' });
        }
    };

    /** @param {any} item */
    const retire = async (item) => {
        const ok = await confirm(
            `"${item.label}"을(를) 체크리스트에서 뺍니다.\n지난 기록은 그대로 남고, 나중에 다시 되살릴 수 있습니다.`,
            { title: '항목 빼기', confirmText: '빼기', danger: true },
        );
        if (!ok) return;
        try {
            await axios.delete(`/api/admin/hygiene/items/${item.id}`, authCfg());
            load();
        } catch {
            notify('항목을 빼지 못했습니다.', { icon: '⚠️' });
        }
    };

    /** @param {any} item */
    const restore = async (item) => {
        try {
            await axios.patch(`/api/admin/hygiene/items/${item.id}`, { is_active: true }, authCfg());
            load();
        } catch {
            notify('되살리지 못했습니다.', { icon: '⚠️' });
        }
    };

    return (
        <StatsLayout title="📋 체크리스트 수정" onBack={onBack} actions={<ThemeToggle />}>
            <style>{`
                .hyg-row { display: grid; grid-template-columns: 26px 108px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border-color, #eee); background: var(--card-bg, #fff); }
                .hyg-row.dragging { opacity: .55; }
                /* touch-action: none이 없으면 터치 드래그가 페이지 스크롤에 먹힌다. */
                .hyg-grip { touch-action: none; cursor: grab; user-select: none; text-align: center; color: var(--text-secondary, #bbb); font-size: 1rem; line-height: 1; padding: 6px 0; }
                .hyg-grip:active { cursor: grabbing; }
                .hyg-row:last-child { border-bottom: none; }
                /* input과 select의 브라우저 기본 높이가 달라, height로 고정하고 폰트를 상속시킨다. */
                .hyg-input { height: 34px; padding: 0 10px; font-family: inherit; font-size: .92rem; line-height: normal; border: 1px solid var(--border-color, #ddd); border-radius: 8px; background: var(--bg-color, #fff); color: var(--text-primary, #222); box-sizing: border-box; width: 100%; }
                .hyg-actions { display: flex; gap: 4px; align-items: center; }
                .hyg-add { display: grid; grid-template-columns: 26px 108px minmax(0, 1fr) auto; gap: 10px; align-items: center; margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--border-color, #ddd); }
                /* 첫 항목을 만들 때는 위에 맞출 목록이 없다. 손잡이 자리를 빼고 왼쪽으로 붙인다. */
                .hyg-add.first { grid-template-columns: 108px minmax(0, 1fr) auto; }
                .hyg-retired { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border-color, #eee); color: var(--text-secondary, #888); }
                .hyg-retired:last-child { border-bottom: none; }
                .hyg-hint { color: var(--text-secondary, #999); font-size: .85rem; line-height: 1.6; margin: 14px 0 0; }
                .hyg-empty { text-align: center; padding: 26px 0; }
                .hyg-empty p { color: var(--text-secondary, #888); margin: 0 0 16px; line-height: 1.6; }
                @media (max-width: 620px) {
                    /* 좁은 화면에서는 분류·문구를 세로로 쌓고 버튼 줄을 따로 둔다. */
                    .hyg-row, .hyg-add { grid-template-columns: 26px minmax(0, 1fr); gap: 6px 10px; }
                    .hyg-row > .hyg-grip { grid-row: span 3; align-self: center; }
                    .hyg-add > .hyg-grip { visibility: hidden; }
                    .hyg-add.first { grid-template-columns: minmax(0, 1fr); }
                    .hyg-actions { justify-content: flex-end; }
                }
            `}</style>

            <StatCard title="체크리스트" icon="📋" wide loading={loading} subtitle={`${active.length}개 항목`}>
                {active.length === 0 ? (
                    <div className="hyg-empty">
                        <p>
                            아직 점검 항목이 없습니다.
                            <br />
                            아래에서 분류를 고르고 점검 문구를 적어 추가하세요.
                        </p>
                    </div>
                ) : (
                    <div ref={listRef}>
                        {active.map((item, idx) => (
                            <div className={`hyg-row ${dragId === item.id ? 'dragging' : ''}`} key={item.id}>
                                <div
                                    className="hyg-grip"
                                    onPointerDown={(e) => dragStart(e, idx, item.id)}
                                    aria-label="끌어서 순서 변경"
                                >
                                    ⠿
                                </div>
                                <select
                                    className="hyg-input"
                                    value={item.category}
                                    onChange={(e) => {
                                        editField(item.id, 'category', e.target.value);
                                        saveField({ ...item, category: e.target.value }, 'category');
                                    }}
                                    aria-label="분류"
                                >
                                    {CATEGORIES.map((c) => (
                                        <option key={c} value={c}>
                                            {c}
                                        </option>
                                    ))}
                                </select>
                                <input
                                    className="hyg-input"
                                    value={item.label}
                                    onChange={(e) => editField(item.id, 'label', e.target.value)}
                                    onBlur={() => saveField(item, 'label')}
                                    aria-label="점검 문구"
                                />
                                <div className="hyg-actions">
                                    <Button variant="danger" size="sm" onClick={() => retire(item)}>
                                        빼기
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <div className={`hyg-add ${active.length === 0 ? 'first' : ''}`}>
                    {active.length > 0 && <div className="hyg-grip" aria-hidden="true" />}
                    <select
                        className="hyg-input"
                        value={draft.category}
                        onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                        aria-label="분류"
                    >
                        {CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                                {c}
                            </option>
                        ))}
                    </select>
                    <input
                        className="hyg-input"
                        placeholder="점검 문구 (예: 냉장고 온도 5℃ 이하 확인)"
                        value={draft.label}
                        onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                        onKeyDown={(e) => e.key === 'Enter' && addItem()}
                    />
                    <Button onClick={addItem}>추가</Button>
                </div>

                {active.length > 0 && (
                    <p className="hyg-hint">
                        문구를 고치면 칸을 벗어날 때 자동 저장됩니다.{' '}
                        <strong>이미 제출된 기록은 바뀌지 않습니다</strong>— 점검 당시 문구가 기록에 그대로 남습니다.
                    </p>
                )}
            </StatCard>

            {retired.length > 0 && (
                <StatCard title="뺀 항목" icon="🗄️" wide subtitle={`${retired.length}개`}>
                    {retired.map((item) => (
                        <div className="hyg-retired" key={item.id}>
                            <span>
                                {item.category} · {item.label}
                            </span>
                            <Button variant="secondary" size="sm" onClick={() => restore(item)}>
                                되살리기
                            </Button>
                        </div>
                    ))}
                    <p className="hyg-hint">
                        뺀 항목은 오늘 이후 체크리스트에만 나오지 않습니다. 지난 기록에는 그대로 남아 있습니다.
                    </p>
                </StatCard>
            )}
        </StatsLayout>
    );
}

export default HygieneItems;
