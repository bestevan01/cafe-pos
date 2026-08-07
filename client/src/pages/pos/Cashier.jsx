import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { socket } from '../../utils/socket';
import { useNotification } from '../../hooks/useNotification';

function Cashier({ onlyOrder = false, isCashier = false }) {
    const { notify, confirm } = useNotification();
    // ---------------------------------------------------------
    // [1] 상태 관리 (State)
    // ---------------------------------------------------------
    const [cart, setCart] = useState([]);
    const [orderGroups, setOrderGroups] = useState([]);
    const [menuList, setMenuList] = useState([]);
    const [paymentCheckId, setPaymentCheckId] = useState(null);

    // 🌟 이벤트 관련 상태 추가
    const [activeEvents, setActiveEvents] = useState([]);
    const [selectedEventId, setSelectedEventId] = useState(null);
    const [shotConfig, setShotConfig] = useState({}); // 커피 잔별 샷: { [메뉴명]: [0번잔 샷, 1번잔 샷, ...] }
    const [expandedShots, setExpandedShots] = useState({}); // 메뉴별 '샷 추가' 패널 펼침 여부

    // UI 상태 (모바일 반응형)
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth <= 768 : false);

    // ---------------------------------------------------------
    // [2] 초기화 및 소켓 연결
    // ---------------------------------------------------------
    const getAuthHeader = () => ({
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });

    // DB에서 온 평문 데이터를 주문 번호별로 그룹화
    const groupOrdersById = (flatList) => {
        const map = {};
        flatList.forEach((item) => {
            const id = item.daily_number;
            if (!map[id])
                map[id] = {
                    daily_number: item.daily_number,
                    display_id: item.display_id,
                    is_paid: item.is_paid,
                    is_completed: item.is_completed,
                    items: [],
                };
            map[id].items.push({ menu_name: item.menu_name, quantity: item.quantity, price: item.total_price });
        });
        return Object.values(map).sort((a, b) => b.daily_number - a.daily_number);
    };

    // ---------------------------------------------------------
    // [3] 데이터 조회 (API)
    // ---------------------------------------------------------
    const fetchMenu = useCallback(async () => {
        try {
            const res = await axios.get('/api/menu', getAuthHeader());
            setMenuList(res.data);
        } catch {
            notify('주문 화면 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', {
                icon: '⚠️',
                dedupeKey: 'load-pos',
            });
        }
    }, [notify]);

    const fetchOrders = useCallback(async () => {
        try {
            const res = await axios.get('/api/orders', getAuthHeader());
            setOrderGroups(groupOrdersById(res.data));
        } catch {
            notify('주문 화면 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', {
                icon: '⚠️',
                dedupeKey: 'load-pos',
            });
        }
    }, [notify]);

    // 🌟 이벤트 목록 불러와서 '사용 중(is_active=1)'인 것만 추려내기
    const fetchActiveEvents = useCallback(async () => {
        try {
            const res = await axios.get('/api/events', getAuthHeader());
            const activeList = res.data.filter((ev) => ev.is_active === 1);
            setActiveEvents(activeList);

            setSelectedEventId((prevId) => {
                if (prevId && !activeList.find((ev) => ev.id === prevId)) return null;
                return prevId;
            });
        } catch {
            notify('주문 화면 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', {
                icon: '⚠️',
                dedupeKey: 'load-pos',
            });
        }
    }, [notify]);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 768);
        window.addEventListener('resize', handleResize);

        // fetchOrders/fetchMenu/fetchActiveEvents는 useCallback으로 메모이즈된 비동기 함수라 setState가 await 이후에만 일어남(effect 본문에서 동기 호출 아님) — 규칙 오탐.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void fetchOrders();
        void fetchMenu();
        void fetchActiveEvents();

        socket.on('new_order', (newOrderGroup) => setOrderGroups((prev) => [newOrderGroup, ...prev]));
        socket.on('order_updated', ({ display_id, is_paid, is_completed, is_delivered }) => {
            setOrderGroups((prev) => {
                const target = prev.find((g) => g.display_id === display_id);
                if (!target) return prev;
                const nextPaid = is_paid !== undefined ? is_paid : target.is_paid;
                const nextCompleted = is_completed !== undefined ? is_completed : target.is_completed;
                const nextDelivered = is_delivered !== undefined ? is_delivered : 0;
                if (nextPaid === 1 && nextCompleted === 1 && nextDelivered === 1)
                    return prev.filter((g) => g.display_id !== display_id);
                return prev.map((group) =>
                    group.display_id === display_id
                        ? {
                              ...group,
                              is_paid: nextPaid,
                              is_completed: nextCompleted,
                          }
                        : group,
                );
            });
        });
        socket.on('order_deleted', (deletedId) =>
            setOrderGroups((prev) => prev.filter((group) => group.display_id !== deletedId)),
        );
        socket.on('events_updated', () => {
            void fetchActiveEvents();
        });

        return () => {
            window.removeEventListener('resize', handleResize);
            socket.off('new_order');
            socket.off('order_updated');
            socket.off('order_deleted');
            socket.off('events_updated');
        };
    }, [fetchOrders, fetchMenu, fetchActiveEvents]);

    // ---------------------------------------------------------
    // [4] 장바구니 및 🌟 이벤트 할인 로직
    // ---------------------------------------------------------
    const SHOT_PRICE = 500;
    const isCoffee = (name) => name.includes('아메리카노') || name.includes('라떼') || name.includes('아샷추');

    // 메뉴의 잔 수(total)와 잔별 샷 배열(slots) 반환.
    // 커피는 잔마다 샷을 따로 두므로 shotConfig에서, 비커피는 cart 수량에서 읽는다.
    const getMenuCounts = (menu) => {
        if (isCoffee(menu.name)) {
            const slots = shotConfig[menu.name] || [];
            return { total: slots.length, slots };
        }
        const qty = cart.find((i) => i.name === menu.name)?.quantity || 0;
        return { total: qty, slots: [] };
    };

    // 잔 수 증감. 커피는 잔 슬롯을 추가/제거(새 잔은 0샷), 비커피는 cart 수량 증감.
    const handleTotalChange = (menu, delta) => {
        if (isCoffee(menu.name)) {
            setShotConfig((prev) => {
                const slots = [...(prev[menu.name] || [])];
                if (delta > 0) slots.push(0);
                else slots.pop();
                const next = { ...prev };
                if (slots.length > 0) next[menu.name] = slots;
                else delete next[menu.name];
                return next;
            });
            return;
        }
        setCart((prev) => {
            const idx = prev.findIndex((i) => i.name === menu.name);
            if (delta > 0) {
                if (idx >= 0) {
                    const c = [...prev];
                    c[idx] = { ...c[idx], quantity: c[idx].quantity + 1 };
                    return c;
                }
                return [...prev, { name: menu.name, price: menu.price, quantity: 1 }];
            }
            if (idx < 0) return prev;
            const c = [...prev];
            if (c[idx].quantity > 1) c[idx] = { ...c[idx], quantity: c[idx].quantity - 1 };
            else c.splice(idx, 1);
            return c;
        });
    };

    // 특정 잔(slotIndex)의 샷 수 증감
    const handleSlotShotChange = (menu, slotIndex, delta) => {
        setShotConfig((prev) => {
            const slots = [...(prev[menu.name] || [])];
            if (slotIndex < 0 || slotIndex >= slots.length) return prev;
            slots[slotIndex] = Math.max(0, slots[slotIndex] + delta);
            return { ...prev, [menu.name]: slots };
        });
    };

    // '샷 추가' 패널 펼치기/접기
    const toggleShotPanel = (menuName) => {
        setExpandedShots((prev) => ({ ...prev, [menuName]: !prev[menuName] }));
    };

    // 비커피(cart) + 커피(shotConfig를 같은 샷끼리 묶어 라인화) → 결제/주문에 쓰는 통합 목록
    const coffeeItems = [];
    Object.entries(shotConfig).forEach(([menuName, slots]) => {
        const menu = menuList.find((m) => m.name === menuName);
        if (!menu || slots.length === 0) return;
        const byShot = {};
        slots.forEach((s) => {
            byShot[s] = (byShot[s] || 0) + 1;
        });
        Object.entries(byShot).forEach(([shotStr, qty]) => {
            const shots = parseInt(shotStr, 10);
            const name = shots > 0 ? `${menuName} (샷추가 ${shots}개)` : menuName;
            coffeeItems.push({ name, price: menu.price + SHOT_PRICE * shots, quantity: qty });
        });
    });
    const allItems = [...cart, ...coffeeItems];

    // 🌟 원가 및 이벤트 할인가 계산 로직
    const originalTotalAmount = allItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    let finalTotalAmount = originalTotalAmount;
    let eventAppliedQty = 0;

    const selectedEvent = activeEvents.find((ev) => ev.id === selectedEventId);

    if (selectedEvent && allItems.length > 0) {
        let totalDiscount = 0;

        let remainingQty =
            selectedEvent.daily_limit !== null
                ? selectedEvent.daily_limit - (selectedEvent['used_count'] || 0)
                : Infinity;

        allItems.forEach((item) => {
            let isEligible = true;

            // 1. 특정 메뉴에만 적용되는 이벤트인지 검사
            if (selectedEvent.target_menus && selectedEvent.target_menus !== 'all') {
                try {
                    const targets = JSON.parse(selectedEvent.target_menus);
                    isEligible = targets.some((targetName) => item.name.includes(targetName));
                } catch {
                    isEligible = false;
                }
            }

            // 2. 해당되면 할인액 누적 계산
            if (isEligible && remainingQty > 0) {
                const discountableQty = Math.min(item.quantity, remainingQty);

                eventAppliedQty += discountableQty;
                remainingQty -= discountableQty;

                if (selectedEvent.type === 'free') {
                    totalDiscount += item.price * discountableQty; // 100% 무료
                } else if (selectedEvent.type === 'discount') {
                    // 할인액이 아이템 가격을 넘지 못하도록 최대치 설정
                    const discountPerItem = Math.min(item.price, selectedEvent.discount_amount);
                    totalDiscount += discountPerItem * discountableQty; // 정액 할인
                }
            }
        });

        finalTotalAmount = Math.max(0, originalTotalAmount - totalDiscount);
    }

    // ---------------------------------------------------------
    // [5] 주문 및 상태 관리 핸들러
    // ---------------------------------------------------------
    const submitOrder = async (isForced = false) => {
        if (allItems.length === 0) return notify('메뉴를 하나 이상 선택해주세요!', { icon: '⚠️' });

        const itemsToSend = [];

        let remainingQty =
            selectedEvent && selectedEvent.daily_limit !== null
                ? selectedEvent.daily_limit - (selectedEvent['used_count'] || 0)
                : Infinity;

        allItems.forEach((item) => {
            let isEligible = true;
            if (selectedEvent && selectedEvent.target_menus && selectedEvent.target_menus !== 'all') {
                try {
                    const targets = JSON.parse(selectedEvent.target_menus);
                    isEligible = targets.some((targetName) => item.name.includes(targetName));
                } catch {
                    isEligible = false;
                }
            } else if (!selectedEvent) {
                isEligible = false;
            }

            if (isEligible && remainingQty > 0) {
                const discountableQty = Math.min(item.quantity, remainingQty);
                const regularQty = item.quantity - discountableQty;

                let discountedPrice = item.price;
                if (selectedEvent.type === 'free') discountedPrice = 0;
                else if (selectedEvent.type === 'discount')
                    discountedPrice = Math.max(0, item.price - selectedEvent.discount_amount);

                // 🌟 1. 이벤트가 적용된 메뉴: 꼬리표(applied_event_id)를 달아줍니다!
                itemsToSend.push({
                    menu_name: item.name,
                    price: discountedPrice,
                    quantity: discountableQty,
                    applied_event_id: selectedEventId,
                });

                remainingQty -= discountableQty;

                if (regularQty > 0) {
                    // 🌟 2. 한도 초과로 원가 결제되는 메뉴: 꼬리표 안 닮(null)
                    itemsToSend.push({
                        menu_name: item.name,
                        price: item.price,
                        quantity: regularQty,
                        applied_event_id: null,
                    });
                }
            } else {
                // 🌟 3. 이벤트 대상이 아닌 메뉴: 꼬리표 안 닮(null)
                itemsToSend.push({
                    menu_name: item.name,
                    price: item.price,
                    quantity: item.quantity,
                    applied_event_id: null,
                });
            }
        });

        const user = JSON.parse(localStorage.getItem('user') || '{"name":"익명"}');

        try {
            const res = await axios.post(
                '/api/orders',
                {
                    items: itemsToSend,
                    total_price: finalTotalAmount,
                    force: isForced,
                    staff_name: user.name,
                    applied_event_id: selectedEventId,
                    applied_event_qty: eventAppliedQty,
                },
                getAuthHeader(),
            );

            if (res.data.success) {
                setCart([]);
                setShotConfig({});
                setExpandedShots({}); // 주문 후 샷 패널 모두 접힌 상태로 초기화
                setSelectedEventId(null);
            } else if (res.data.message) {
                notify(res.data.message, { icon: '⚠️' });
                await fetchActiveEvents();
            } else if (res.data.isDuplicate) {
                if (await confirm('그래도 등록하시겠습니까?', { title: '⚠️ 중복 주문 감지', confirmText: '등록' }))
                    await submitOrder(true);
            }
        } catch {
            notify('주문 전송 실패', { icon: '⚠️' });
        }
    };

    const handleConfirmPayment = async (method, overrideId = null) => {
        const targetId = overrideId || paymentCheckId;
        if (!targetId) return;
        const apiPath = isCashier ? `/api/orders/${targetId}/pay` : `/api/orders/${targetId}/complete`;
        try {
            await axios.patch(apiPath, { paymentMethod: method }, getAuthHeader());
            if (!overrideId) setPaymentCheckId(null);
        } catch (/** @type {any} */ err) {
            notify('처리 실패: ' + err.message, { icon: '⚠️' });
        }
    };

    const handleDeliver = async (displayId) => {
        try {
            await axios.patch(`/api/orders/${displayId}/deliver`, {}, getAuthHeader());
        } catch {
            notify('전달 처리 실패', { icon: '⚠️' });
        }
    };
    const handleDelete = async (displayId) => {
        if (!(await confirm('정말 삭제하시겠습니까?', { title: '⚠️ 주문 삭제', confirmText: '삭제', danger: true })))
            return;
        try {
            await axios.delete(`/api/orders/${displayId}`, getAuthHeader());
        } catch {
            notify('주문 삭제 실패', { icon: '⚠️' });
        }
    };

    // ---------------------------------------------------------
    // [6] 렌더링 (Render)
    // ---------------------------------------------------------
    const OrderGridContent = (
        <div className="order-grid">
            <AnimatePresence>
                <>
                    {orderGroups.map((group) => {
                        const groupTotal = group.items.reduce((acc, item) => acc + item.price, 0);
                        return (
                            <motion.div
                                key={group.daily_number}
                                className="receipt-card"
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.2 } }}
                                layout
                            >
                                <div className="receipt-header">
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <h1 className="receipt-num">#{String(group.daily_number).padStart(3, '0')}</h1>
                                        {group.is_completed === 1 ? (
                                            <span className="badge badge-done">조리 완료 🍳</span>
                                        ) : (
                                            <span className="badge badge-cooking">조리 중 ⏳</span>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                        <button
                                            onClick={() => handleDelete(group.display_id)}
                                            className="btn-action btn-cancel"
                                        >
                                            주문 취소
                                        </button>
                                        {group.is_paid === 0 ? (
                                            <button
                                                onClick={() => {
                                                    // 🌟 핵심: 총액이 0원이면 팝업 없이 즉시 'event' 결제 완료! 0원이 아니면 팝업 띄우기
                                                    if (groupTotal === 0) {
                                                        void handleConfirmPayment('event', group.display_id);
                                                    } else {
                                                        setPaymentCheckId(group.display_id);
                                                    }
                                                }}
                                                className="btn-action btn-pay"
                                            >
                                                결제 확인
                                            </button>
                                        ) : (
                                            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                                                <span className="badge badge-paid">입금 완료 💰</span>
                                                {group.is_completed === 1 && (
                                                    <button
                                                        onClick={() => handleDeliver(group.display_id)}
                                                        className="btn-action btn-deliver"
                                                    >
                                                        전달 완료 🤲
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div style={{ flex: 1, overflowY: 'auto', marginBottom: '10px' }}>
                                    {group.items.map((item, idx) => (
                                        <div key={idx} className="receipt-item">
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <span
                                                    style={{
                                                        color: item.menu_name.includes('(샷')
                                                            ? 'var(--accent)'
                                                            : 'inherit',
                                                    }}
                                                >
                                                    {item.menu_name}
                                                </span>
                                                <span
                                                    style={{
                                                        fontSize: '0.85rem',
                                                        color: 'var(--text-secondary, #888)',
                                                    }}
                                                >
                                                    {(item.price / item.quantity).toLocaleString()}원
                                                </span>
                                            </div>
                                            <div style={{ fontWeight: 'bold' }}>{item.quantity}</div>
                                        </div>
                                    ))}
                                </div>
                                <div className="receipt-total">
                                    <span>합계</span>
                                    <span style={{ color: 'var(--danger)' }}>{groupTotal.toLocaleString()}원</span>
                                </div>
                            </motion.div>
                        );
                    })}
                </>
            </AnimatePresence>
            {orderGroups.length === 0 && (
                <p style={{ textAlign: 'center', color: 'var(--text-secondary, #888)', marginTop: '50px' }}>
                    진행 중인 주문이 없습니다.
                </p>
            )}
        </div>
    );

    return (
        <div className="pos-container">
            <style>
                {`
                /* (기존 스타일 유지) */
                .pos-container { display: flex; flex-direction: row; width: 100vw; height: 100vh; height: 100dvh; background-color: var(--bg-color, #eef2f5); overflow: hidden; box-sizing: border-box; transition: background-color 0.3s ease; }
                .pos-left { flex: 1; display: flex; flex-direction: column; padding: 65px 20px 20px 20px; border-right: 1px solid var(--border-color, #ddd); background-color: var(--card-bg, #fff); z-index: 2; box-sizing: border-box; min-height: 0; min-width: 0; transition: background-color 0.3s ease, border-color 0.3s ease; }
                .menu-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 15px; overflow-y: auto; padding-right: 5px; padding-bottom: 20px; flex: 1; scrollbar-width: thin; align-content: start; }
                .cart-bottom { display: flex; flex-direction: column; padding-top: 15px; margin-top: auto; border-top: 2px solid var(--border-color, #ddd); }
                .total-info { padding: 15px; background-color: var(--card-bg, #fff); border-radius: var(--radius-md); border: 2px solid var(--text-primary, #333); display: flex; justify-content: space-between; align-items: center; font-size: 1.4rem; font-weight: bold; margin-bottom: 10px; color: var(--text-primary, #333); }
                .pos-right { flex: 1; display: flex; flex-direction: column; padding: 65px 20px 20px 20px; background-color: var(--bg-color, #eef2f5); overflow: hidden; box-sizing: border-box; min-height: 0; min-width: 0; }
                .header-bar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 3px solid var(--text-primary, #333); }
                .pos-title { margin: 0; font-size: 1.8rem; font-weight: 800; color: var(--text-primary, #333); }
                .btn-sidebar-toggle { padding: 10px 15px; background-color: var(--accent); color: white; border: none; border-radius: var(--radius-md); font-weight: bold; cursor: pointer; font-size: 1rem; box-shadow: 0 4px 10px rgba(66, 165, 245, 0.35); transition: transform 0.1s, background-color 0.2s; }
                .btn-sidebar-toggle:active { transform: scale(0.96); background-color: var(--accent-hover); }
                .btn-back { margin-bottom: 15px; padding: 10px 15px; background-color: var(--neutral); color: white; border: none; border-radius: var(--radius-md); font-weight: bold; cursor: pointer; align-self: flex-start; font-size: 0.9rem; transition: transform 0.1s; }
                .btn-back:active { transform: scale(0.95); }
                .btn-submit { width: 100%; padding: 15px; font-size: 1.5rem; font-weight: bold; background-color: var(--text-primary, #222); color: var(--bg-color, white); border: none; border-radius: var(--radius-md); cursor: pointer; box-shadow: 0 4px 10px rgba(0,0,0,0.1); transition: transform 0.1s; }
                .btn-submit:active { transform: scale(0.98); }
                .menu-card { display: flex; flex-direction: column; justify-content: flex-start; border: 1px solid var(--border-color, #eee); border-radius: var(--radius-lg); padding: 18px 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.03); transition: all 0.2s; background-color: var(--card-bg, #fff); cursor: pointer; box-sizing: border-box; height: fit-content; }
                .menu-card.selected { border: 2px solid var(--accent); background-color: var(--accent-bg); }
                .menu-card.soldout { opacity: 0.5; cursor: not-allowed; background-color: var(--border-color, #e0e0e0); }
                .menu-name { font-size: 1.2rem; font-weight: bold; color: var(--text-primary, #333); margin-bottom: 4px; }
                .menu-price { color: var(--text-secondary, #666); font-size: 1rem; }
                .circle-btn { width: 35px; height: 35px; border-radius: 50%; border: 1px solid var(--border-color, #ccc); background-color: var(--card-bg, #fff); color: var(--text-primary, #333); font-size: 1.2rem; cursor: pointer; display: flex; align-items: center; justify-content: center; }
                .qty-text { font-size: 1.4rem; font-weight: bold; width: 30px; text-align: center; color: var(--text-primary, #333); }
                .shot-box { margin-top: 15px; padding: 10px; background-color: var(--accent-bg); border-radius: var(--radius-sm); border: 1px dashed rgba(66, 165, 245, 0.35); animation: slideDown 0.2s ease-out forwards; transform-origin: top center; }
                @keyframes slideDown { from { opacity: 0; transform: scaleY(0.8); } to { opacity: 1; transform: scaleY(1); } }
                .shot-toggle { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; background: none; border: none; cursor: pointer; font-size: 0.9rem; font-weight: bold; color: var(--text-secondary, #555); padding: 2px 0; }
                .shot-toggle > span:last-child { font-size: 0.8rem; color: var(--accent); }
                .shot-slots { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; padding-top: 8px; border-top: 1px dashed rgba(66, 165, 245, 0.3); }
                .shot-slot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
                .shot-slot-label { font-size: 0.85rem; font-weight: bold; color: var(--text-primary, #333); width: 48px; flex-shrink: 0; }
                .shot-slot-stepper { display: flex; align-items: center; gap: 10px; }
                .shot-slot-count { font-size: 1.05rem; font-weight: bold; width: 18px; text-align: center; color: var(--accent); }
                .shot-slot-price { font-size: 0.8rem; color: var(--text-secondary, #888); width: 64px; text-align: right; flex-shrink: 0; }
                .mini-circle-btn { width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--accent); background-color: var(--card-bg, #fff); color: var(--accent); font-size: 1rem; cursor: pointer; display: flex; align-items: center; justify-content: center; }
                .sidebar-backdrop { position: fixed; top: 0; left: 0; width: 100vw; height: 100dvh; background-color: rgba(0,0,0,0.5); z-index: 90; backdrop-filter: blur(3px); }
                .sidebar-panel { position: fixed; top: 0; right: 0; width: 100%; height: 100dvh; background-color: var(--bg-color, #eef2f5); z-index: 100; display: flex; flex-direction: column; padding: 20px; padding-top: 65px; box-sizing: border-box; box-shadow: -10px 0 30px rgba(0,0,0,0.15); }
                .btn-close { background: none; border: none; font-size: 2.5rem; cursor: pointer; color: var(--text-primary, #333); line-height: 1; padding: 0 5px; }
                .order-grid { display: flex; flex-direction: column; gap: 15px; overflow-y: auto; height: 100%; padding-right: 5px; scrollbar-width: thin; }
                .receipt-card { background-color: var(--card-bg, #fff); border: 1px solid var(--border-color, #ddd); border-top: 5px solid var(--danger); border-radius: var(--radius-lg); padding: 20px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); display: flex; flex-direction: column; flex-shrink: 0; }
                .receipt-header { border-bottom: 2px dashed var(--border-color, #ddd); padding-bottom: 10px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; }
                .receipt-num { margin: 0; color: var(--danger); font-size: 1.8rem; font-weight: bold; }
                .receipt-item { display: flex; justify-content: space-between; align-items: center; font-size: 1.1rem; margin-bottom: 8px; border-bottom: 1px solid var(--border-color, #f0f0f0); padding-bottom: 5px; color: var(--text-primary, #333); }
                .receipt-total { border-top: 2px solid var(--text-primary, #333); padding-top: 10px; margin-top: 10px; display: flex; justify-content: space-between; font-size: 1.3rem; font-weight: bold; color: var(--text-primary, #333); }
                .badge { padding: 5px 10px; border-radius: var(--radius-sm); font-size: 0.85rem; font-weight: bold; display: inline-block; }
                .badge-cooking { border: 1px solid var(--warning); color: var(--warning); background-color: var(--warning-bg); }
                .badge-done { border: 1px solid var(--accent); color: var(--accent); background-color: var(--accent-bg); }
                .badge-paid { color: var(--success); border: 2px solid var(--success); background-color: var(--success-bg); }
                .btn-action { padding: 8px 12px; font-size: 0.9rem; border: none; border-radius: var(--radius-sm); cursor: pointer; font-weight: bold; transition: opacity 0.2s; }
                .btn-action:active { opacity: 0.8; }
                .btn-cancel { background-color: var(--danger); color: white; }
                .btn-pay { background-color: var(--success); color: white; }
                .btn-deliver { background-color: var(--accent); color: white; }
                .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; }
                .modal-content { background-color: var(--card-bg, white); padding: 30px; border-radius: var(--radius-lg); text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.2); width: 90%; max-width: 450px; box-sizing: border-box; }
                .btn-modal-opt { flex: 1; padding: 20px; border: none; border-radius: var(--radius-md); color: white; font-size: 1.1rem; font-weight: bold; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; transition: opacity 0.2s; }
                .btn-modal-opt:active { opacity: 0.8; }

                
                .event-selector { padding: 0 5px; margin-bottom: 10px; width: 100%; overflow: hidden; box-sizing: border-box; }
                .event-chip-container { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 5px; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
                .event-chip-container::-webkit-scrollbar { display: none; } /* 크롬/사파리 스크롤바 숨김 */
                .event-chip { flex-shrink: 0; padding: 8px 15px; border: 1px solid var(--border-color, #ccc); border-radius: 20px; background-color: var(--card-bg, #fff); color: var(--text-secondary, #666); font-size: 0.95rem; cursor: pointer; white-space: nowrap; transition: all 0.2s ease; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
                .event-chip.active { background-color: var(--danger); color: white; border-color: var(--danger); font-weight: bold; box-shadow: 0 4px 8px rgba(220,53,69,0.3); }
                .event-chip.soldout { opacity: 0.5; background-color: var(--border-color, #eee); cursor: not-allowed; text-decoration: line-through; box-shadow: none; }

                @media (max-width: 768px) {
                    /* 전역 헤더가 한 줄(테마는 사용자 드롭다운으로 이동)이라 65px면 충분 */
                    .pos-left { border-right: none; padding: 15px; padding-top: 65px; }
                    .menu-list { grid-template-columns: 1fr; }
                    .pos-title { font-size: 1.5rem; }
                }
                `}
            </style>

            <div className="pos-left">
                <div className="header-bar">
                    <h2 className="pos-title">🛒 메뉴 선택</h2>
                    {isMobile && !onlyOrder && (
                        <button onClick={() => setIsSidebarOpen(true)} className="btn-sidebar-toggle">
                            📋 주문 현황 ({orderGroups.length})
                        </button>
                    )}
                </div>

                <div className="menu-list">
                    {menuList.map((menu) => {
                        const { total, slots } = getMenuCounts(menu);
                        const isSoldOut = menu.is_soldout === 1;
                        return (
                            <div
                                key={menu.id}
                                className={`menu-card ${total > 0 ? 'selected' : ''} ${isSoldOut ? 'soldout' : ''}`}
                                onClick={() => !isSoldOut && handleTotalChange(menu, 1)}
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        width: '100%',
                                    }}
                                >
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        <div className="menu-name">
                                            {menu.name}
                                            {isSoldOut && (
                                                <span style={{ color: 'var(--danger)', marginLeft: '5px' }}>
                                                    (품절)
                                                </span>
                                            )}
                                        </div>
                                        <div className="menu-price">{menu.price.toLocaleString()}원</div>
                                    </div>
                                    {!isSoldOut && (
                                        <div
                                            style={{ display: 'flex', alignItems: 'center', gap: '15px' }}
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <button className="circle-btn" onClick={() => handleTotalChange(menu, -1)}>
                                                -
                                            </button>
                                            <span className="qty-text">{total}</span>
                                            <button className="circle-btn" onClick={() => handleTotalChange(menu, 1)}>
                                                +
                                            </button>
                                        </div>
                                    )}
                                </div>
                                {!isSoldOut && isCoffee(menu.name) && total > 0 && (
                                    <div className="shot-box" onClick={(e) => e.stopPropagation()}>
                                        <button className="shot-toggle" onClick={() => toggleShotPanel(menu.name)}>
                                            <span>
                                                ☕ 샷 추가
                                                {slots.reduce((a, b) => a + b, 0) > 0
                                                    ? ` · 총 ${slots.reduce((a, b) => a + b, 0)}샷`
                                                    : ''}
                                            </span>
                                            <span>{expandedShots[menu.name] ? '▴ 접기' : '▾ 잔별 설정'}</span>
                                        </button>
                                        {expandedShots[menu.name] && (
                                            <div className="shot-slots">
                                                {slots.map((s, i) => (
                                                    <div key={i} className="shot-slot">
                                                        <span className="shot-slot-label">{i + 1}번 잔</span>
                                                        <div className="shot-slot-stepper">
                                                            <button
                                                                className="mini-circle-btn"
                                                                onClick={() => handleSlotShotChange(menu, i, -1)}
                                                                disabled={s === 0}
                                                            >
                                                                -
                                                            </button>
                                                            <span className="shot-slot-count">{s}</span>
                                                            <button
                                                                className="mini-circle-btn"
                                                                onClick={() => handleSlotShotChange(menu, i, 1)}
                                                            >
                                                                +
                                                            </button>
                                                        </div>
                                                        <span className="shot-slot-price">
                                                            {s > 0 ? `샷추가 ${s}개` : '기본'}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="cart-bottom">
                    {/* 🌟 이벤트 선택 칩 UI */}
                    {activeEvents.length > 0 && (
                        <div className="event-selector">
                            <div
                                style={{
                                    fontSize: '0.85rem',
                                    fontWeight: 'bold',
                                    marginBottom: '8px',
                                    color: 'var(--text-secondary)',
                                }}
                            >
                                🎁 적용 가능한 이벤트 (터치하여 적용)
                            </div>
                            <div className="event-chip-container">
                                {activeEvents.map((ev) => {
                                    // 🌟 복구됨: 남은 수량을 계산하고, 0개면 마감 처리합니다.
                                    const remaining = ev.daily_limit ? ev.daily_limit - (ev['used_count'] || 0) : null;
                                    const isSoldOut = remaining !== null && remaining <= 0;

                                    return (
                                        <button
                                            key={ev.id}
                                            onClick={() =>
                                                !isSoldOut &&
                                                setSelectedEventId((prev) => (prev === ev.id ? null : ev.id))
                                            }
                                            className={`event-chip ${selectedEventId === ev.id ? 'active' : ''} ${isSoldOut ? 'soldout' : ''}`}
                                            disabled={isSoldOut}
                                        >
                                            {ev.name}
                                            {/* 남은 수량 표시 (무제한이면 안 보여줌) */}
                                            {remaining !== null && remaining > 0 ? ` (남은 수량: ${remaining}잔)` : ''}
                                            {isSoldOut ? ' [마감]' : ''}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* 🌟 총액 및 할인 내역 표시 */}
                    <div className="total-info">
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span>총 결제 금액</span>
                            {selectedEvent && (
                                <span
                                    style={{
                                        fontSize: '0.9rem',
                                        color: 'var(--danger)',
                                        fontWeight: 'normal',
                                        marginTop: '4px',
                                    }}
                                >
                                    ✅ {selectedEvent.name} 적용됨
                                </span>
                            )}
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            {selectedEvent && (
                                <div
                                    style={{
                                        textDecoration: 'line-through',
                                        color: 'var(--text-secondary, #999)',
                                        fontSize: '1.1rem',
                                    }}
                                >
                                    {originalTotalAmount.toLocaleString()}원
                                </div>
                            )}
                            <span style={{ color: 'var(--danger)' }}>{finalTotalAmount.toLocaleString()}원</span>
                        </div>
                    </div>
                    <button onClick={() => submitOrder(false)} className="btn-submit">
                        주문 전송 ({allItems.reduce((a, c) => a + c.quantity, 0)}건)
                    </button>
                </div>
            </div>

            {/* 우측 패널 (주문 현황) */}
            {!onlyOrder &&
                (isMobile ? (
                    <AnimatePresence>
                        {isSidebarOpen && (
                            <>
                                <motion.div
                                    className="sidebar-backdrop"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    onClick={() => setIsSidebarOpen(false)}
                                />
                                <motion.div
                                    className="sidebar-panel"
                                    initial={{ x: '100%' }}
                                    animate={{ x: 0 }}
                                    exit={{ x: '100%' }}
                                    transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
                                >
                                    <div className="header-bar">
                                        <h2 className="pos-title">📋 주문 현황</h2>
                                        <button className="btn-close" onClick={() => setIsSidebarOpen(false)}>
                                            ×
                                        </button>
                                    </div>
                                    {OrderGridContent}
                                </motion.div>
                            </>
                        )}
                    </AnimatePresence>
                ) : (
                    <div className="pos-right">
                        <div className="header-bar">
                            <h2 className="pos-title">📋 주문 현황</h2>
                        </div>
                        {OrderGridContent}
                    </div>
                ))}

            {/* 🌟 결제 확인 모달 (+ 이벤트 버튼 추가) */}
            {paymentCheckId && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <h2 style={{ marginBottom: '10px', color: 'var(--text-primary, #333)' }}>결제 수단 확인</h2>
                        <p
                            style={{
                                marginBottom: '20px',
                                color: 'var(--text-secondary, #666)',
                            }}
                        >
                            #{paymentCheckId.split('-')[1]}번 주문을 처리합니다.
                        </p>

                        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                            <button
                                onClick={() => handleConfirmPayment('cash')}
                                className="btn-modal-opt"
                                style={{ backgroundColor: '#2e7d32' }}
                            >
                                <div style={{ fontSize: '2rem', marginBottom: '5px' }}>💵</div>
                                현금
                            </button>
                            <button
                                onClick={() => handleConfirmPayment('bank')}
                                className="btn-modal-opt"
                                style={{ backgroundColor: '#ed6c02' }}
                            >
                                <div style={{ fontSize: '2rem', marginBottom: '5px' }}>🏦</div>
                                계좌
                            </button>
                        </div>

                        <button
                            onClick={() => setPaymentCheckId(null)}
                            style={{
                                padding: '12px 30px',
                                backgroundColor: 'var(--border-color, #eee)',
                                color: 'var(--text-primary, #333)',
                                border: 'none',
                                borderRadius: 'var(--radius-md)',
                                fontWeight: 'bold',
                                fontSize: '1rem',
                                cursor: 'pointer',
                                width: '100%',
                            }}
                        >
                            닫기
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Cashier;
