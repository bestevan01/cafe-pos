import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useEmptyAfterExit } from '../../hooks/useEmptyAfterExit';
import axios from 'axios';
import { socket } from '../../utils/socket';
import { useNotification } from '../../hooks/useNotification';

/**
 * 한 주문의 항목이 모두 체크됐는지. 전부 체크되면 '조리 완료' 버튼을 눈에 띄게 바꾼다.
 * 자동으로 완료 처리하지는 않는다 — 잘못 체크했을 때 되돌릴 수 있어야 하고,
 * 컵에 담아 내보내는 마지막 확인은 사람이 한 번 하는 게 맞다.
 * @param {import('../../types').OrderGroup} group
 */
const allMade = (group) => group.items.length > 0 && group.items.every((it) => it.is_made === 1);

function Kitchen() {
    const { notify, confirm } = useNotification();
    // ---------------------------------------------------------
    // [1] 상태 관리 (State)
    // ---------------------------------------------------------
    const [orderGroups, setOrderGroups] = useState(/** @type {import('../../types').OrderGroup[]} */ ([]));
    const { showEmpty, onExitComplete: onEmptyExitComplete } = useEmptyAfterExit(orderGroups.length);

    // ---------------------------------------------------------
    // [2] API 및 소켓 통신
    // ---------------------------------------------------------
    const getAuthHeader = () => ({
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });

    // DB에서 온 평문 데이터를 주문 번호별로 그룹화
    /** @param {import('../../types').OrderRow[]} flatList */
    const groupOrdersById = (flatList) => {
        /** @type {Record<string, import('../../types').OrderGroup>} */
        const map = {};
        flatList.forEach((item) => {
            if (item.is_completed === 1) return;

            const id = item.daily_number;
            if (!map[id]) {
                map[id] = {
                    daily_number: item.daily_number,
                    display_id: item.display_id,
                    is_paid: item.is_paid,
                    items: [],
                };
            }
            map[id].items.push({
                id: item.id,
                menu_name: item.menu_name,
                quantity: item.quantity,
                price: item.total_price,
                is_made: item.is_made ?? 0,
            });
        });
        return Object.values(map).sort((a, b) => b.daily_number - a.daily_number);
    };

    const fetchOrders = useCallback(async () => {
        try {
            const res = await axios.get('/api/orders', getAuthHeader());
            const grouped = groupOrdersById(res.data);
            setOrderGroups(grouped);
        } catch {
            notify('주문 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', {
                icon: '⚠️',
                dedupeKey: 'load-kitchen',
            });
        }
    }, [notify]);

    useEffect(() => {
        // fetchOrders는 useCallback으로 메모이즈된 비동기 함수라 setState가 await 이후에만 일어남(effect 본문에서 동기 호출 아님) — 규칙 오탐.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void fetchOrders();

        // 실시간 주문 수신
        socket.on('new_order', (newOrderGroup) => {
            setOrderGroups((prev) => [newOrderGroup, ...prev]);
        });

        // 주문 상태 업데이트 (결제완료 or 조리완료)
        socket.on('order_updated', ({ display_id, is_paid, is_completed }) => {
            if (is_completed === 1) {
                // 조리 완료 시 목록에서 제거
                setOrderGroups((prev) => prev.filter((group) => group.display_id !== display_id));
            } else {
                // 결제 상태 변경 시 업데이트
                setOrderGroups((prev) =>
                    prev.map((group) => {
                        if (group.display_id === display_id) {
                            return { ...group, is_paid: is_paid };
                        }
                        return group;
                    }),
                );
            }
        });

        // 다른 기기에서 누른 항목 체크. 같은 주문을 나눠 만들 때 서로 어디까지 했는지 보인다.
        socket.on('order_item_made', ({ display_id, id, is_made }) => {
            setOrderGroups((prev) =>
                prev.map((group) =>
                    group.display_id === display_id
                        ? {
                              ...group,
                              items: group.items.map((it) => (it.id === id ? { ...it, is_made } : it)),
                          }
                        : group,
                ),
            );
        });

        // 주문 취소/삭제 수신
        socket.on('order_deleted', (deletedId) => {
            setOrderGroups((prev) => prev.filter((group) => group.display_id !== deletedId));
        });

        return () => {
            socket.off('new_order');
            socket.off('order_updated');
            socket.off('order_item_made');
            socket.off('order_deleted');
        };
    }, [fetchOrders]);

    // ---------------------------------------------------------
    // [3] 이벤트 핸들러
    // ---------------------------------------------------------
    /**
     * 항목 하나를 만들었다/아니다로 표시한다.
     * 화면을 먼저 바꾸고 요청을 보낸다 — 만드는 중에 한 박자 기다리게 하고 싶지 않다.
     * 실패하면 되돌리고 알린다. 성공하면 서버가 보낸 order_item_made가 모든 기기를 맞춘다.
     * @param {string} displayId @param {string} itemId @param {number} next 0|1
     */
    const handleToggleMade = async (displayId, itemId, next) => {
        const apply = (/** @type {number} */ value) =>
            setOrderGroups((prev) =>
                prev.map((group) =>
                    group.display_id === displayId
                        ? {
                              ...group,
                              items: group.items.map((it) => (it.id === itemId ? { ...it, is_made: value } : it)),
                          }
                        : group,
                ),
            );

        apply(next);
        try {
            await axios.patch(`/api/orders/items/${itemId}/made`, { made: next === 1 }, getAuthHeader());
        } catch {
            apply(next === 1 ? 0 : 1);
            notify('체크를 저장하지 못했습니다.', { icon: '⚠️', dedupeKey: 'item-made' });
        }
    };

    /** @param {string} displayId */
    const handleComplete = async (displayId) => {
        if (!(await confirm('조리를 완료 처리하시겠습니까?', { confirmText: '완료' }))) return;
        try {
            await axios.patch(`/api/orders/${displayId}/complete_kitchen`, {}, getAuthHeader());
        } catch {
            notify('처리 실패', { icon: '⚠️' });
        }
    };

    /** @param {string} displayId */
    const handleDelete = async (displayId) => {
        if (
            !(await confirm('주문을 취소하시겠습니까?', {
                title: '⚠️ 주문 취소',
                confirmText: '주문 취소',
                danger: true,
            }))
        )
            return;
        try {
            await axios.delete(`/api/orders/${displayId}`, getAuthHeader());
        } catch {
            notify('삭제 실패', { icon: '⚠️' });
        }
    };

    // ---------------------------------------------------------
    // [4] 렌더링 (Render)
    // ---------------------------------------------------------
    return (
        <div className="kitchen-container">
            <style>
                {`
                /* 전체 레이아웃 */
                .kitchen-container { position: relative; display: flex; flex-direction: column; width: 100vw; height: 100vh; height: 100dvh; background-color: var(--bg-color, #f4f6f8); padding: 20px; padding-top: 65px; box-sizing: border-box; transition: background-color 0.3s ease; }
                
                /* 상단 헤더 및 버튼 */
                .btn-back-floating { position: absolute; top: 15px; left: 20px; z-index: 10000; padding: 8px 12px; font-size: 0.95rem; font-weight: bold; background-color: var(--neutral); color: white; border: none; border-radius: var(--radius-md); cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.15); transition: transform 0.1s; }
                .btn-back-floating:active { transform: scale(0.95); }
                .kitchen-header-bar { border-bottom: 3px solid var(--text-primary, #333); padding-bottom: 15px; margin-bottom: 20px; }
                .kitchen-title { margin: 0; font-size: 2rem; font-weight: 800; color: var(--text-primary, #333); }
                
                /* 주문 그리드 */
                .order-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); alignItems: start; gap: 20px; overflow-y: auto; height: 100%; padding-right: 5px; scrollbar-width: thin; align-content: start; }
                
                /* 영수증 카드 스타일 */
                .receipt-card { background-color: var(--card-bg, #fff); border: 1px solid var(--border-color, #ddd); border-top: 6px solid var(--danger); border-radius: var(--radius-lg); padding: 20px; box-shadow: var(--shadow-md); display: flex; flex-direction: column; }
                .receipt-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px dashed var(--border-color, #ddd); padding-bottom: 10px; margin-bottom: 10px; }
                .receipt-num { margin: 0; color: var(--danger); font-size: 2.5rem; font-weight: bold; }
                
                /* 뱃지 및 리스트 아이템 */
                .badge-paid { color: var(--success); border: 2px solid var(--success); padding: 6px 12px; border-radius: var(--radius-sm); font-size: 0.9rem; font-weight: bold; background-color: var(--success-bg); }
                .badge-unpaid { color: var(--warning); border: 2px solid var(--warning); padding: 6px 12px; border-radius: var(--radius-sm); font-size: 0.9rem; font-weight: bold; background-color: var(--warning-bg); }
                /* 항목 자체가 체크 버튼이다. 만들면서 누르는 것이라 손가락이 닿는 면을 넓게 잡는다. */
                .receipt-item { display: flex; align-items: center; gap: 10px; width: 100%; font-size: 1.2rem; margin-bottom: 8px; border: none; border-bottom: 1px solid var(--border-color, #f0f0f0); border-radius: var(--radius-sm); padding: 10px 6px; background: none; color: var(--text-primary, #333); font-family: inherit; text-align: left; cursor: pointer; -webkit-tap-highlight-color: transparent; }
                .receipt-item:active { background-color: var(--bg-color, #f4f6f8); }
                .item-name { flex: 1; }
                .item-qty { font-weight: bold; color: var(--text-primary, #111); font-size: 1.3rem; }
                /* 빈 네모를 늘 띄워 둔다. 체크했을 때만 자리가 생기면 글자가 밀려 읽기 어렵다. */
                .item-check { flex-shrink: 0; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border: 2px solid var(--border-color, #ccc); border-radius: var(--radius-sm); color: #fff; font-size: 1.1rem; font-weight: 800; }
                .receipt-item.made { color: var(--text-secondary, #999); }
                .receipt-item.made .item-name { text-decoration: line-through; }
                .receipt-item.made .item-qty { color: var(--text-secondary, #999); }
                .receipt-item.made .item-check { background-color: var(--success); border-color: var(--success); }
                
                /* 액션 버튼 그룹 */
                .btn-group { display: flex; gap: 10px; margin-top: 15px; }
                .btn-cancel { flex: 1; padding: 15px; font-size: 1.1rem; background-color: var(--danger); color: white; border: none; border-radius: var(--radius-md); cursor: pointer; font-weight: bold; transition: opacity 0.2s; }
                .btn-complete { flex: 2; padding: 15px; font-size: 1.2rem; background-color: var(--success); color: white; border: none; border-radius: var(--radius-md); cursor: pointer; font-weight: bold; transition: opacity 0.2s; }
                .btn-cancel:active, .btn-complete:active { opacity: 0.8; }
                /* 전부 체크되면 버튼을 키워 '이제 내보내도 된다'를 알린다. 처리는 여전히 직접 누른다. */
                .btn-complete.ready { box-shadow: 0 0 0 3px var(--success-bg), 0 4px 12px rgba(0,0,0,.18); transform: scale(1.02); }

                /* 모바일 반응형 */
                @media (max-width: 768px) {
                    .kitchen-container { padding: 15px; padding-top: 55px; } 
                    .btn-back-floating { top: 10px; left: 10px; padding: 6px 10px; font-size: 0.85rem; }
                    .kitchen-title { font-size: 1.5rem; }
                    .order-grid { grid-template-columns: 1fr; } 
                    .receipt-num { font-size: 2rem; }
                }
                `}
            </style>

            <div className="kitchen-header-bar">
                <h1 className="kitchen-title">👨‍🍳 음료 제조 리스트</h1>
            </div>

            <div className="order-grid">
                <AnimatePresence onExitComplete={onEmptyExitComplete}>
                    {orderGroups.map((group) => (
                        <motion.div
                            key={group.daily_number}
                            className="receipt-card"
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.2 } }}
                            layout
                        >
                            <div className="receipt-header">
                                <h1 className="receipt-num">#{String(group.daily_number).padStart(3, '0')}</h1>
                                <div>
                                    {group.is_paid === 1 ? (
                                        <span className="badge-paid">입금 완료 💰</span>
                                    ) : (
                                        <span className="badge-unpaid">미입금 ⚠️</span>
                                    )}
                                </div>
                            </div>

                            <div style={{ flex: 1, overflowY: 'auto', marginBottom: '5px' }}>
                                {group.items.map((item, idx) => {
                                    const made = item.is_made === 1;
                                    // 서버가 아직 옛 버전이면 항목 id가 없다(배포 시차). 그때는 체크만 막고
                                    // 목록은 그대로 보여준다 — 주문을 못 보는 것보다 낫다.
                                    const itemId = item.id;
                                    return (
                                        <button
                                            key={itemId ?? idx}
                                            type="button"
                                            className={`receipt-item${made ? ' made' : ''}`}
                                            aria-pressed={made}
                                            disabled={!itemId}
                                            onClick={() =>
                                                itemId && handleToggleMade(group.display_id, itemId, made ? 0 : 1)
                                            }
                                        >
                                            <span className="item-check" aria-hidden="true">
                                                {made ? '✓' : ''}
                                            </span>
                                            <span
                                                className="item-name"
                                                style={{
                                                    color:
                                                        !made && item.menu_name.includes('(샷')
                                                            ? 'var(--accent)'
                                                            : undefined,
                                                }}
                                            >
                                                {item.menu_name}
                                            </span>
                                            <span className="item-qty">{item.quantity}</span>
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="btn-group">
                                <button onClick={() => handleDelete(group.display_id)} className="btn-cancel">
                                    취소
                                </button>
                                <button
                                    onClick={() => handleComplete(group.display_id)}
                                    className={`btn-complete${allMade(group) ? ' ready' : ''}`}
                                >
                                    조리 완료 ✅
                                </button>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>

                {showEmpty && (
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.25 }}
                        style={{
                            textAlign: 'center',
                            color: 'var(--text-secondary, #888)',
                            marginTop: '50px',
                            fontSize: '1.2rem',
                            gridColumn: '1 / -1',
                        }}
                    >
                        현재 대기 중인 주문이 없습니다. ☕
                    </motion.p>
                )}
            </div>
        </div>
    );
}

export default Kitchen;
