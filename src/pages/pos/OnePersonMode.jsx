import {useState, useEffect} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { socket } from '../../utils/socket';

function OnePersonMode({ onlyOrder = false, isCashier = false, onBack }) {
    // ---------------------------------------------------------
    // [1] 상태 관리 (State)
    // ---------------------------------------------------------
    const [cart, setCart] = useState([]);
    const [orderGroups, setOrderGroups] = useState([]);
    const [menuList, setMenuList] = useState([]);
    const [paymentCheckId, setPaymentCheckId] = useState(null); // 결제 모달용 ID

    // UI 상태 (모바일 반응형)
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth <= 768 : false);

    // ---------------------------------------------------------
    // [2] 초기화 및 소켓 연결
    // ---------------------------------------------------------
    const getAuthHeader = () => ({
        headers: {Authorization: `Bearer ${localStorage.getItem('token')}`}
    });

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 768);
        window.addEventListener('resize', handleResize);

        void fetchOrders();
        void fetchMenu();

        // 1. 새 주문 수신
        socket.on('new_order', (newOrderGroup) => {
            setOrderGroups(prev => [newOrderGroup, ...prev]);
        });

        // 2. 주문 상태 업데이트 (결제, 조리, 전달 완료)
        socket.on('order_updated', ({ display_id, is_paid, is_completed, is_delivered }) => {
            setOrderGroups(prev => {
                const target = prev.find(g => g.display_id === display_id);
                if (!target) return prev;

                const nextPaid = (is_paid !== undefined) ? is_paid : target.is_paid;
                const nextCompleted = (is_completed !== undefined) ? is_completed : target.is_completed;
                const nextDelivered = (is_delivered !== undefined) ? is_delivered : 0;

                // 모든 단계 완료 시 목록에서 제거
                if (nextPaid === 1 && nextCompleted === 1 && nextDelivered === 1) {
                    return prev.filter(g => g.display_id !== display_id);
                }

                return prev.map(group => {
                    if (group.display_id === display_id) {
                        return { ...group, is_paid: nextPaid, is_completed: nextCompleted };
                    }
                    return group;
                });
            });
        });

        // 3. 주문 삭제
        socket.on('order_deleted', (deletedId) => {
            setOrderGroups(prev => prev.filter(group => group.display_id !== deletedId));
        });

        return () => {
            window.removeEventListener('resize', handleResize);
            socket.off('new_order');
            socket.off('order_updated');
            socket.off('order_deleted');
        };
    }, []);

    // ---------------------------------------------------------
    // [3] 데이터 조회 및 변환 (API)
    // ---------------------------------------------------------
    const fetchMenu = async () => {
        try {
            const res = await axios.get('/api/menu', getAuthHeader());
            setMenuList(res.data);
        } catch (err) {
            console.error("메뉴 로딩 실패:", err);
        }
    };

    const fetchOrders = async () => {
        try {
            const res = await axios.get('/api/orders', getAuthHeader());
            setOrderGroups(groupOrdersById(res.data));
        } catch (err) {
            console.error("주문 로딩 실패");
        }
    };

    // 평문 데이터를 주문 번호별로 그룹화
    const groupOrdersById = (flatList) => {
        const map = {};
        flatList.forEach(item => {
            const id = item.daily_number;
            if (!map[id]) {
                map[id] = {
                    daily_number: item.daily_number,
                    display_id: item.display_id,
                    is_paid: item.is_paid,
                    is_completed: item.is_completed,
                    items: []
                };
            }
            map[id].items.push({menu_name: item.menu_name, quantity: item.quantity, price: item.total_price});
        });
        return Object.values(map).sort((a, b) => b.daily_number - a.daily_number);
    };

    // ---------------------------------------------------------
    // [4] 장바구니 로직 (Cart Logic)
    // ---------------------------------------------------------
    const addToCart = (menu, isShotAdded = false) => {
        const finalName = isShotAdded ? `${menu.name} (샷추가)` : menu.name;
        const finalPrice = isShotAdded ? menu.price + 500 : menu.price;

        setCart(prev => {
            const existingIdx = prev.findIndex(item => item.name === finalName);
            if (existingIdx !== -1) {
                const newCart = [...prev];
                newCart[existingIdx] = { ...newCart[existingIdx], quantity: newCart[existingIdx].quantity + 1 };
                return newCart;
            }
            return [...prev, { name: finalName, price: finalPrice, quantity: 1 }];
        });
    };

    const removeFromCart = (menuName) => {
        setCart(prev => {
            const idx = prev.findIndex(item => item.name === menuName);
            if (idx === -1) return prev;

            const newCart = [...prev];
            if (newCart[idx].quantity > 1) {
                newCart[idx] = {...newCart[idx], quantity: newCart[idx].quantity - 1};
            } else {
                newCart.splice(idx, 1);
            }
            return newCart;
        });
    };

    // 메뉴별 수량 집계 (기본/샷추가 구분)
    const getMenuCounts = (menu) => {
        const normalName = menu.name;
        const shotName = `${menu.name} (샷추가)`;
        const normalQty = cart.find(i => i.name === normalName)?.quantity || 0;
        const shotQty = cart.find(i => i.name === shotName)?.quantity || 0;
        return { normal: normalQty, shot: shotQty, total: normalQty + shotQty };
    };

    // +/- 버튼 핸들러
    const handleTotalChange = (menu, delta) => {
        const { normal, shot } = getMenuCounts(menu);
        if (delta === 1) {
            addToCart(menu, false);
        } else {
            if (normal > 0) removeFromCart(menu.name);
            else if (shot > 0) removeFromCart(`${menu.name} (샷추가)`);
        }
    };

    const handleShotChange = (menu, delta) => {
        const { normal, shot } = getMenuCounts(menu);
        if (delta === 1) {
            if (normal > 0) { removeFromCart(menu.name); addToCart(menu, true); }
        } else {
            if (shot > 0) { removeFromCart(`${menu.name} (샷추가)`); addToCart(menu, false); }
        }
    };

    const currentTotalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const isCoffee = (name) => name.includes('아메리카노') || name.includes('라떼') || name.includes('아샷추');

    // ---------------------------------------------------------
    // [5] 주문 및 상태 관리 핸들러
    // ---------------------------------------------------------
    const submitOrder = async (isForced = false) => {
        if (cart.length === 0) return alert("메뉴를 하나 이상 선택해주세요!");

        const itemsToSend = cart.map(item => ({ menu_name: item.name, price: item.price, quantity: item.quantity }));
        const user = JSON.parse(localStorage.getItem('user') || '{"name":"익명"}');

        try {
            const res = await axios.post('/api/orders', {
                items: itemsToSend, total_price: currentTotalAmount, force: isForced, staff_name: user.name
            }, getAuthHeader());

            if (res.data.success) {
                setCart([]);
            } else if (res.data.isDuplicate) {
                if (window.confirm("⚠️ 중복 주문 감지! 그래도 등록하시겠습니까?")) await submitOrder(true);
            }
        } catch (err) {
            alert("주문 전송 실패");
        }
    };

    const handleConfirmPayment = async (method) => {
        if (!paymentCheckId) return;
        const apiPath = isCashier ? `/api/orders/${paymentCheckId}/pay` : `/api/orders/${paymentCheckId}/complete`;
        try {
            await axios.patch(apiPath, {paymentMethod: method}, getAuthHeader());
            setPaymentCheckId(null);
        } catch (err) {
            alert("처리 실패: " + err.message);
        }
    };

    const handleDeliver = async (displayId) => {
        try {
            await axios.patch(`/api/orders/${displayId}/deliver`, {}, getAuthHeader());
        } catch (err) {
        }
    };

    const handleDelete = async (displayId) => {
        if (!window.confirm("⚠️ 정말 삭제하시겠습니까?")) return;
        try {
            await axios.delete(`/api/orders/${displayId}`, getAuthHeader());
        } catch (err) {
        }
    };

    // ---------------------------------------------------------
    // [6] 렌더링 (Render)
    // ---------------------------------------------------------

    // 공통 주문 리스트 컴포넌트
    const OrderGridContent = (
        <div className="order-grid">
            <AnimatePresence>
                <>
                    {orderGroups.map((group) => {
                    const groupTotal = group.items.reduce((acc, item) => acc + item.price, 0);
                    return (
                        <motion.div
                            key={group.daily_number} className="receipt-card"
                            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.2 } }} layout
                        >
                            <div className="receipt-header">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <h1 className="receipt-num">#{String(group.daily_number).padStart(3, '0')}</h1>
                                    {group.is_completed === 1 ? <span className="badge badge-done">조리 완료 🍳</span> :
                                        <span className="badge badge-cooking">조리 중 ⏳</span>}
                                </div>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    <button onClick={() => handleDelete(group.display_id)} className="btn-action btn-cancel">주문 취소</button>
                                    {group.is_paid === 0 ? (
                                        <button onClick={() => setPaymentCheckId(group.display_id)} className="btn-action btn-pay">결제 확인</button>
                                    ) : (
                                        <div style={{display: 'flex', gap: '5px', alignItems: 'center'}}>
                                            <span className="badge badge-paid">입금 완료 💰</span>
                                            {group.is_completed === 1 &&
                                                <button onClick={() => handleDeliver(group.display_id)}
                                                        className="btn-action btn-deliver">전달 완료 🤲</button>}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div style={{ flex: 1, overflowY: 'auto', marginBottom: '10px' }}>
                                {group.items.map((item, idx) => (
                                    <div key={idx} className="receipt-item">
                                        <div style={{display: 'flex', flexDirection: 'column'}}>
                                            <span
                                                style={{color: item.menu_name.includes('샷추가') ? '#007bff' : 'inherit'}}>{item.menu_name}</span>
                                            <span style={{
                                                fontSize: '0.85rem',
                                                color: 'var(--text-secondary, #888)'
                                            }}>{(item.price / item.quantity).toLocaleString()}원</span>
                                        </div>
                                        <div style={{ fontWeight: 'bold' }}>{item.quantity}</div>
                                    </div>
                                ))}
                            </div>
                            <div className="receipt-total">
                                <span>합계</span><span style={{color: '#d32f2f'}}>{groupTotal.toLocaleString()}원</span>
                            </div>
                        </motion.div>
                    );
                    })}
                </>
            </AnimatePresence>
            {orderGroups.length === 0 &&
                <p style={{textAlign: 'center', color: 'var(--text-secondary, #888)', marginTop: '50px'}}>진행 중인 주문이
                    없습니다.</p>}
        </div>
    );

    return (
        <div className="pos-container">
            <style>
                {`
                /* 전체 레이아웃 */
                .pos-container { display: flex; flex-direction: row; width: 100vw; height: 100vh; height: 100dvh; background-color: var(--bg-color, #eef2f5); overflow: hidden; box-sizing: border-box; transition: background-color 0.3s ease; }
                
                /* 좌측 패널 (메뉴) */
                .pos-left { flex: 1; display: flex; flex-direction: column; padding: 20px; border-right: 1px solid var(--border-color, #ddd); background-color: var(--card-bg, #fff); z-index: 2; box-sizing: border-box; min-height: 0; transition: background-color 0.3s ease, border-color 0.3s ease; }
                .menu-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 15px; overflow-y: auto; padding-right: 5px; padding-bottom: 20px; flex: 1; scrollbar-width: thin; align-content: start; }
                .cart-bottom { display: flex; flex-direction: column; padding-top: 15px; margin-top: auto; border-top: 2px solid var(--border-color, #ddd); }
                .total-info { padding: 15px; background-color: var(--card-bg, #fff); border-radius: var(--radius-md); border: 2px solid var(--text-primary, #333); display: flex; justify-content: space-between; align-items: center; font-size: 1.4rem; font-weight: bold; margin-bottom: 10px; color: var(--text-primary, #333); }
                
                /* 우측 패널 (주문 현황 - PC) */
                .pos-right { flex: 1; display: flex; flex-direction: column; padding: 20px; background-color: var(--bg-color, #eef2f5); overflow: hidden; box-sizing: border-box; min-height: 0; }
                
                /* 헤더 & 버튼 */
                .header-bar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 3px solid var(--text-primary, #333); }
                .pos-title { margin: 0; font-size: 1.8rem; font-weight: 800; color: var(--text-primary, #333); }
                .btn-sidebar-toggle { padding: 10px 15px; background-color: #007bff; color: white; border: none; border-radius: var(--radius-md); font-weight: bold; cursor: pointer; font-size: 1rem; box-shadow: 0 4px 10px rgba(0,123,255,0.3); transition: transform 0.1s, background-color 0.2s; }
                .btn-sidebar-toggle:active { transform: scale(0.96); background-color: #0056b3; }
                .btn-back { margin-bottom: 15px; padding: 10px 15px; background-color: #6c757d; color: white; border: none; border-radius: var(--radius-md); font-weight: bold; cursor: pointer; align-self: flex-start; font-size: 0.9rem; transition: transform 0.1s; }
                .btn-back:active { transform: scale(0.95); }
                .btn-submit { width: 100%; padding: 15px; font-size: 1.5rem; font-weight: bold; background-color: var(--text-primary, #222); color: var(--bg-color, white); border: none; border-radius: var(--radius-md); cursor: pointer; box-shadow: 0 4px 10px rgba(0,0,0,0.1); transition: transform 0.1s; }
                .btn-submit:active { transform: scale(0.98); }

                /* 메뉴 카드 스타일 */
                .menu-card { display: flex; flex-direction: column; justify-content: flex-start; border: 1px solid var(--border-color, #eee); border-radius: var(--radius-lg); padding: 18px 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.03); transition: all 0.2s; background-color: var(--card-bg, #fff); cursor: pointer; box-sizing: border-box; height: fit-content; }
                .menu-card.selected { border: 2px solid #007bff; background-color: rgba(0, 123, 255, 0.05); }
                .menu-card.soldout { opacity: 0.5; cursor: not-allowed; background-color: var(--border-color, #e0e0e0); }
                .menu-name { font-size: 1.2rem; font-weight: bold; color: var(--text-primary, #333); margin-bottom: 4px; }
                .menu-price { color: var(--text-secondary, #666); font-size: 1rem; }
                
                /* 버튼 및 컨트롤 */
                .circle-btn { width: 35px; height: 35px; border-radius: 50%; border: 1px solid var(--border-color, #ccc); background-color: var(--card-bg, #fff); color: var(--text-primary, #333); font-size: 1.2rem; cursor: pointer; display: flex; align-items: center; justify-content: center; }
                .qty-text { font-size: 1.4rem; font-weight: bold; width: 30px; text-align: center; color: var(--text-primary, #333); }
                .shot-box { margin-top: 15px; padding: 10px; background-color: rgba(0, 123, 255, 0.05); border-radius: var(--radius-sm); border: 1px dashed rgba(0, 123, 255, 0.3); animation: slideDown 0.2s ease-out forwards; transform-origin: top center; }
                @keyframes slideDown { from { opacity: 0; transform: scaleY(0.8); } to { opacity: 1; transform: scaleY(1); } }
                .mini-circle-btn { width: 28px; height: 28px; border-radius: 50%; border: 1px solid #007bff; background-color: var(--card-bg, #fff); color: #007bff; font-size: 1rem; cursor: pointer; display: flex; align-items: center; justify-content: center; }

                /* 모바일 사이드바 (모달) */
                .sidebar-backdrop { position: fixed; top: 0; left: 0; width: 100vw; height: 100dvh; background-color: rgba(0,0,0,0.5); z-index: 90; backdrop-filter: blur(3px); }
                .sidebar-panel { position: fixed; top: 0; right: 0; width: 100%; height: 100dvh; background-color: var(--bg-color, #eef2f5); z-index: 100; display: flex; flex-direction: column; padding: 20px; padding-top: 65px; box-sizing: border-box; box-shadow: -10px 0 30px rgba(0,0,0,0.15); }
                .btn-close { background: none; border: none; font-size: 2.5rem; cursor: pointer; color: var(--text-primary, #333); line-height: 1; padding: 0 5px; }

                /* 주문 리스트 및 영수증 카드 */
                .order-grid { display: flex; flex-direction: column; gap: 15px; overflow-y: auto; height: 100%; padding-right: 5px; scrollbar-width: thin; }
                .receipt-card { background-color: var(--card-bg, #fff); border: 1px solid var(--border-color, #ddd); border-top: 5px solid #d32f2f; border-radius: var(--radius-lg); padding: 20px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); display: flex; flex-direction: column; flex-shrink: 0; }
                .receipt-header { border-bottom: 2px dashed var(--border-color, #ddd); padding-bottom: 10px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; }
                .receipt-num { margin: 0; color: #d32f2f; font-size: 1.8rem; font-weight: bold; }
                .receipt-item { display: flex; justify-content: space-between; align-items: center; font-size: 1.1rem; margin-bottom: 8px; border-bottom: 1px solid var(--border-color, #f0f0f0); padding-bottom: 5px; color: var(--text-primary, #333); }
                .receipt-total { border-top: 2px solid var(--text-primary, #333); padding-top: 10px; margin-top: 10px; display: flex; justify-content: space-between; font-size: 1.3rem; font-weight: bold; color: var(--text-primary, #333); }

                /* 뱃지 및 액션 버튼 */
                .badge { padding: 5px 10px; border-radius: var(--radius-sm); font-size: 0.85rem; font-weight: bold; display: inline-block; }
                .badge-cooking { border: 1px solid #ff9800; color: #ff9800; background-color: rgba(255,152,0,0.1); }
                .badge-done { border: 1px solid #007bff; color: #007bff; background-color: rgba(0,123,255,0.1); }
                .badge-paid { color: #28a745; border: 2px solid #28a745; background-color: rgba(40,167,69,0.1); }
                .btn-action { padding: 8px 12px; font-size: 0.9rem; border: none; border-radius: var(--radius-sm); cursor: pointer; font-weight: bold; transition: opacity 0.2s; }
                .btn-action:active { opacity: 0.8; }
                .btn-cancel { background-color: #dc3545; color: white; }
                .btn-pay { background-color: #28a745; color: white; }
                .btn-deliver { background-color: #007bff; color: white; }

                /* 결제 모달 */
                .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; }
                .modal-content { background-color: var(--card-bg, white); padding: 30px; border-radius: var(--radius-lg); text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.2); width: 90%; max-width: 400px; box-sizing: border-box; }
                .btn-modal-opt { flex: 1; padding: 20px; border: none; border-radius: var(--radius-md); color: white; font-size: 1.2rem; font-weight: bold; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; }

                /* 모바일 최적화 */
                @media (max-width: 768px) {
                    .pos-left { border-right: none; padding: 15px; padding-top: 65px; }
                    .menu-list { grid-template-columns: 1fr; }
                    .pos-title { font-size: 1.5rem; }
                }
                `}
            </style>

            {/* 좌측 패널 (메뉴판) */}
            <div className="pos-left">
                {onBack && <button onClick={onBack} className="btn-back">⬅ 역할 다시 선택하기</button>}

                <div className="header-bar">
                    <h2 className="pos-title">🛒 메뉴 선택</h2>
                    {isMobile && !onlyOrder &&
                        <button onClick={() => setIsSidebarOpen(true)} className="btn-sidebar-toggle">📋 주문 현황
                            ({orderGroups.length})</button>}
                </div>

                <div className="menu-list">
                    {menuList.map(menu => {
                        const { total, shot } = getMenuCounts(menu);
                        const isSoldOut = menu.is_soldout === 1;
                        return (
                            <div key={menu.id}
                                 className={`menu-card ${total > 0 ? 'selected' : ''} ${isSoldOut ? 'soldout' : ''}`}
                                 onClick={() => !isSoldOut && handleTotalChange(menu, 1)}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        <div className="menu-name">{menu.name}{isSoldOut &&
                                            <span style={{color: '#dc3545', marginLeft: '5px'}}>(품절)</span>}</div>
                                        <div className="menu-price">{menu.price.toLocaleString()}원</div>
                                    </div>
                                    {!isSoldOut && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }} onClick={(e) => e.stopPropagation()}>
                                            <button className="circle-btn" onClick={() => handleTotalChange(menu, -1)}>-</button>
                                            <span className="qty-text">{total}</span>
                                            <button className="circle-btn" onClick={() => handleTotalChange(menu, 1)}>+</button>
                                        </div>
                                    )}
                                </div>
                                {!isSoldOut && isCoffee(menu.name) && total > 0 && (
                                    <div className="shot-box" onClick={(e) => e.stopPropagation()}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                                            <div style={{
                                                fontSize: '0.9rem',
                                                fontWeight: 'bold',
                                                color: 'var(--text-secondary, #555)'
                                            }}>☕ 샷 추가 <span style={{fontSize: '0.8rem', opacity: 0.7}}>(+500원)</span>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <button className="mini-circle-btn" onClick={() => handleShotChange(menu, -1)} disabled={shot === 0}>-</button>
                                                <span style={{ fontSize: '1.1rem', fontWeight: 'bold', width: '20px', textAlign: 'center', color: '#007bff' }}>{shot}</span>
                                                <button className="mini-circle-btn" onClick={() => handleShotChange(menu, 1)} disabled={shot >= total}>+</button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="cart-bottom">
                    <div className="total-info">
                        <span>총 결제 금액</span><span
                        style={{color: '#d32f2f'}}>{currentTotalAmount.toLocaleString()}원</span>
                    </div>
                    <button onClick={() => submitOrder(false)} className="btn-submit">주문 전송
                        ({cart.reduce((a, c) => a + c.quantity, 0)}건)
                    </button>
                </div>
            </div>

            {/* 우측 패널 (주문 현황) - PC/Mobile 분기 */}
            {!onlyOrder && (
                isMobile ? (
                    <AnimatePresence>
                        {isSidebarOpen && (
                            <>
                                <motion.div className="sidebar-backdrop" initial={{opacity: 0}} animate={{opacity: 1}}
                                            exit={{opacity: 0}} onClick={() => setIsSidebarOpen(false)}/>
                                <motion.div className="sidebar-panel" initial={{x: '100%'}} animate={{x: 0}}
                                            exit={{x: '100%'}} transition={{type: 'spring', bounce: 0, duration: 0.4}}>
                                    <div className="header-bar">
                                        <h2 className="pos-title">📋 주문 현황</h2>
                                        <button className="btn-close" onClick={() => setIsSidebarOpen(false)}>×</button>
                                    </div>
                                    {OrderGridContent}
                                </motion.div>
                            </>
                        )}
                    </AnimatePresence>
                ) : (
                    <div className="pos-right">
                        <div className="header-bar"><h2 className="pos-title">📋 주문 현황</h2></div>
                        {OrderGridContent}
                    </div>
                )
            )}

            {/* 결제 확인 모달 */}
            {paymentCheckId && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <h2 style={{marginBottom: '10px', color: 'var(--text-primary, #333)'}}>결제 수단 확인</h2>
                        <p style={{
                            marginBottom: '20px',
                            color: 'var(--text-secondary, #666)'
                        }}>#{paymentCheckId.split('-')[1]}번 주문을 처리합니다.</p>
                        <div style={{display: 'flex', gap: '15px', marginBottom: '20px'}}>
                            <button onClick={() => handleConfirmPayment('cash')} className="btn-modal-opt"
                                    style={{backgroundColor: '#2e7d32'}}>
                                <div style={{fontSize: '2rem', marginBottom: '10px'}}>💵</div>
                                현금
                            </button>
                            <button onClick={() => handleConfirmPayment('bank')} className="btn-modal-opt"
                                    style={{backgroundColor: '#ed6c02'}}>
                                <div style={{fontSize: '2rem', marginBottom: '10px'}}>🏦</div>
                                계좌
                            </button>
                        </div>
                        <button onClick={() => setPaymentCheckId(null)} style={{
                            padding: '12px 30px',
                            backgroundColor: 'var(--border-color, #eee)',
                            color: 'var(--text-primary, #333)',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            fontWeight: 'bold',
                            fontSize: '1rem',
                            cursor: 'pointer',
                            width: '100%'
                        }}>닫기
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default OnePersonMode;