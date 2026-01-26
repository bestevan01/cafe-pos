import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { socket } from './socket';
import { MENU_LIST } from './menuData';

function OnePersonMode({ onlyOrder = false }) {
    const [cart, setCart] = useState([]);
    const [orderGroups, setOrderGroups] = useState([]);

    const cartEndRef = useRef(null);

    useEffect(() => {
        fetchOrders();

        socket.on('new_order', (newOrderGroup) => {
            setOrderGroups(prev => [newOrderGroup, ...prev]);
        });

        socket.on('order_updated', ({ display_id, is_paid, is_completed, is_delivered }) => {
            setOrderGroups(prev => {
                const target = prev.find(g => g.display_id === display_id);
                if (!target) return prev;

                const nextPaid = (is_paid !== undefined) ? is_paid : target.is_paid;
                const nextCompleted = (is_completed !== undefined) ? is_completed : target.is_completed;
                const nextDelivered = (is_delivered !== undefined) ? is_delivered : 0;

                // 3박자(입금 O, 조리 O, 전달 O)가 맞아야 삭제
                if (nextPaid === 1 && nextCompleted === 1 && nextDelivered === 1) {
                    return prev.filter(g => g.display_id !== display_id);
                }

                return prev.map(group => {
                    if (group.display_id === display_id) {
                        return {
                            ...group,
                            is_paid: nextPaid,
                            is_completed: nextCompleted
                        };
                    }
                    return group;
                });
            });
        });

        socket.on('order_deleted', (deletedId) => {
            setOrderGroups(prev => prev.filter(group => group.display_id !== deletedId));
        });

        return () => {
            socket.off('new_order');
            socket.off('order_updated');
            socket.off('order_deleted');
        };
    }, []);

    useEffect(() => {
        if (cartEndRef.current) {
            cartEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [cart]);

    const fetchOrders = async () => {
        const res = await axios.get('/api/orders');
        const grouped = groupOrdersById(res.data);
        setOrderGroups(grouped);
    };

    const groupOrdersById = (flatList) => {
        const map = {};
        flatList.forEach(item => {
            const id = item.daily_number;
            if (!map[id]) {
                map[id] = {
                    daily_number: item.daily_number,
                    display_id: item.display_id,
                    is_paid: item.is_paid,
                    is_completed: item.is_completed, // ✅ 조리 상태 데이터 확인
                    items: []
                };
            }
            map[id].items.push({
                menu_name: item.menu_name,
                quantity: item.quantity,
                price: item.total_price
            });
        });
        return Object.values(map).sort((a, b) => b.daily_number - a.daily_number);
    };

    // --- 장바구니 로직 ---

    const addToCart = (menu, isShotAdded = false) => {
        const finalName = isShotAdded ? `${menu.name} (샷추가)` : menu.name;
        const finalPrice = isShotAdded ? menu.price + 500 : menu.price;

        setCart(prev => {
            const existingIdx = prev.findIndex(item => item.name === finalName);
            if (existingIdx !== -1) {
                const newCart = [...prev];
                newCart[existingIdx] = {
                    ...newCart[existingIdx],
                    quantity: newCart[existingIdx].quantity + 1
                };
                return newCart;
            }
            return [...prev, { name: finalName, price: finalPrice, quantity: 1 }];
        });
    };

    const removeFromCart = (menuName) => {
        setCart(prev => {
            const idx = prev.findIndex(item => item.name === menuName);
            if (idx !== -1) {
                const newCart = [...prev];
                const currentQty = newCart[idx].quantity;

                if (currentQty > 1) {
                    newCart[idx] = { ...newCart[idx], quantity: currentQty - 1 };
                } else {
                    newCart.splice(idx, 1);
                }
                return newCart;
            }
            return prev;
        });
    };

    const deleteItem = (index) => {
        setCart(prev => prev.filter((_, i) => i !== index));
    };

    const getMenuCounts = (menu) => {
        const normalName = menu.name;
        const shotName = `${menu.name} (샷추가)`;

        const normalItem = cart.find(i => i.name === normalName);
        const shotItem = cart.find(i => i.name === shotName);

        const normalQty = normalItem ? normalItem.quantity : 0;
        const shotQty = shotItem ? shotItem.quantity : 0;

        return {
            normal: normalQty,
            shot: shotQty,
            total: normalQty + shotQty
        };
    };

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
            if (normal > 0) {
                removeFromCart(menu.name);
                addToCart(menu, true);
            }
        } else {
            if (shot > 0) {
                removeFromCart(`${menu.name} (샷추가)`);
                addToCart(menu, false);
            }
        }
    };

    const currentTotalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    const submitOrder = async (arg) => {
        const isForced = (arg === true);
        if (cart.length === 0) {
            alert("메뉴를 하나 이상 선택해주세요!");
            return;
        }

        const itemsToSend = cart.map(item => ({
            menu_name: item.name,
            price: item.price,
            quantity: item.quantity
        }));

        try {
            const res = await axios.post('/api/orders', {
                items: itemsToSend,
                total_price: currentTotalAmount,
                force: isForced
            });

            if (res.data.success) {
                setCart([]);
            } else if (res.data.isDuplicate) {
                if (window.confirm("⚠️ 중복 주문 감지! 그래도 등록하시겠습니까?")) {
                    submitOrder(true);
                }
            }
        } catch (err) {
            alert("주문 전송 실패");
        }
    };

    const handleComplete = async (displayId) => {
        if (onlyOrder) {
            if (!window.confirm("입금 확인 처리하시겠습니까?\n(주문 내역 기록이 확정됩니다.)")) return;
            try { await axios.patch(`/api/orders/${displayId}/pay`); } catch (err) {}
        } else {
            if (!window.confirm("주문을 완료 처리하시겠습니까?\n(입금 및 제조가 모두 완료됩니다)")) return;
            try { await axios.patch(`/api/orders/${displayId}/complete`); } catch (err) {}
        }
    };

    const handleDeliver = async (displayId) => {
        try { await axios.patch(`/api/orders/${displayId}/deliver`); } catch (err) {}
    };

    const handleDelete = async (displayId) => {
        if (!window.confirm("⚠️ 정말 삭제하시겠습니까?\n(이 작업은 되돌릴 수 없습니다!)")) return;
        try { await axios.delete(`/api/orders/${displayId}`); } catch (err) {}
    };

    const isCoffee = (name) => {
        return name.includes('아메리카노') || name.includes('라떼') || name.includes('아샷추');
    };

    return (
        <div style={containerStyle}>
            {/* 왼쪽: 메뉴판 영역 */}
            <div style={leftPanelStyle}>

                {/* 1. 상단: 메뉴 리스트 */}
                <div style={{ flex: 1, overflowY: 'auto', paddingRight: '5px', borderBottom: '2px solid #ddd' }}>
                    <h2 style={headerStyle}>🛒 메뉴 선택</h2>

                    <div style={menuListStyle}>
                        {MENU_LIST.filter(m => m.name !== '에스프레소 샷 추가').map(menu => {
                            const { total, shot } = getMenuCounts(menu);
                            const isSelected = total > 0;

                            return (
                                <div key={menu.name} style={menuCardStyle(isSelected)}>

                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#333' }}>
                                                {menu.name}
                                            </div>
                                            <div style={{ color: '#666', fontSize: '1rem' }}>
                                                {menu.price.toLocaleString()}원
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                            <button style={circleBtn} onClick={() => handleTotalChange(menu, -1)}>-</button>
                                            <span style={{ fontSize: '1.4rem', fontWeight: 'bold', width: '30px', textAlign: 'center' }}>
                                                {total}
                                            </span>
                                            <button style={circleBtn} onClick={() => handleTotalChange(menu, 1)}>+</button>
                                        </div>
                                    </div>

                                    {isCoffee(menu.name) && total > 0 && (
                                        <div style={shotOptionContainer}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                                                <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#555', display:'flex', alignItems:'center' }}>
                                                    ☕ 샷 추가 <span style={{fontSize:'0.8rem', color:'#888', marginLeft:'5px'}}>(+500원)</span>
                                                </div>

                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                    <button
                                                        style={miniCircleBtn}
                                                        onClick={() => handleShotChange(menu, -1)}
                                                        disabled={shot === 0}
                                                    >
                                                        -
                                                    </button>
                                                    <span style={{ fontSize: '1.1rem', fontWeight: 'bold', width: '20px', textAlign: 'center', color: '#007bff' }}>
                                                        {shot}
                                                    </span>
                                                    <button
                                                        style={miniCircleBtn}
                                                        onClick={() => handleShotChange(menu, 1)}
                                                        disabled={shot >= total}
                                                    >
                                                        +
                                                    </button>
                                                </div>
                                            </div>
                                            <div style={{ textAlign: 'right', fontSize: '0.8rem', color: '#888', marginTop: '5px' }}>
                                                {total}잔 중 {shot}잔에 샷 추가 적용됨
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* 2. 하단: 주문 전송 (리스트 제거됨) */}
                <div style={{ height: 'auto', display: 'flex', flexDirection: 'column', paddingTop: '10px', marginTop: 'auto', borderTop: '2px solid #ddd' }}>

                    <div style={totalInfoStyle}>
                        <span>총 결제 금액</span>
                        <span style={{ color: '#d32f2f' }}>{currentTotalAmount.toLocaleString()}원</span>
                    </div>

                    <button onClick={submitOrder} style={bigSubmitBtnStyle}>
                        주문 전송 ({cart.reduce((a,c)=>a+c.quantity,0)}건)
                    </button>
                </div>
            </div>

            {/* 오른쪽: 주문 내역 영역 */}
            {!onlyOrder && (
                <div style={rightPanelStyle}>
                    <h2 style={headerStyle}>📋 주문 현황</h2>
                    <div style={orderGridStyle}>
                        <AnimatePresence>
                            {orderGroups.map((group) => {
                                const groupTotal = group.items.reduce((acc, item) => acc + (item.price * item.quantity), 0);
                                return (
                                    <motion.div
                                        key={group.daily_number} style={receiptCardStyle}
                                        initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.2 } }} layout
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px dashed #ddd', paddingBottom: '10px', marginBottom: '10px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <h1 style={{ margin: 0, color: '#d32f2f', fontSize: '2rem' }}>#{String(group.daily_number).padStart(3, '0')}</h1>

                                                {/* ✅ [신규] 조리 상태 뱃지 표시 */}
                                                {group.is_completed === 1 ? (
                                                    <span style={kitchenDoneBadge}>조리 완료 🍳</span>
                                                ) : (
                                                    <span style={cookingBadge}>조리 중 ⏳</span>
                                                )}
                                            </div>

                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button onClick={() => handleDelete(group.display_id)} style={cancelBtnStyle}>주문 취소</button>

                                                {group.is_paid === 0 ? (
                                                    <button style={payBtnStyle} onClick={() => handleComplete(group.display_id)}>입금확인</button>
                                                ) : (
                                                    <div style={{display:'flex', gap:'5px'}}>
                                                        <span style={completedBadgeStyle}>입금 완료 💰</span>
                                                        {group.is_completed === 1 && (
                                                            <button onClick={() => handleDeliver(group.display_id)} style={{...payBtnStyle, backgroundColor: '#007bff'}}>전달 완료 🤲</button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div style={{ flex: 1, overflowY: 'auto', marginBottom: '15px' }}>
                                            {group.items.map((item, idx) => (
                                                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '1.1rem', marginBottom: '8px', borderBottom: '1px solid #f0f0f0', paddingBottom: '5px' }}>
                                                    <div style={{display:'flex', flexDirection:'column'}}>
                                                        <span style={{color: item.menu_name.includes('샷추가') ? '#007bff' : '#333'}}>
                                                            {item.menu_name}
                                                        </span>
                                                        <span style={{fontSize: '0.85rem', color: '#888'}}>{item.price.toLocaleString()}원</span>
                                                    </div>
                                                    <div style={{ fontWeight: 'bold' }}>{item.quantity}</div>
                                                </div>
                                            ))}
                                        </div>

                                        <div style={{ borderTop: '2px solid #333', paddingTop: '10px', marginTop: 'auto', display: 'flex', justifyContent: 'space-between', fontSize: '1.3rem', fontWeight: 'bold' }}>
                                            <span>합계</span>
                                            <span style={{ color: '#d32f2f' }}>{groupTotal.toLocaleString()}원</span>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                    </div>
                </div>
            )}
        </div>
    );
}

// --- 스타일 정의 ---
const containerStyle = { display: 'flex', width: '100vw', height: '100vh', backgroundColor: '#eef2f5', overflow: 'hidden' };
const leftPanelStyle = { flex: 1, display: 'flex', flexDirection: 'column', padding: '20px', borderRight: '1px solid #ddd', backgroundColor: '#fff', boxShadow: '2px 0 10px rgba(0,0,0,0.05)', zIndex: 2 };
const rightPanelStyle = { flex: 1, display: 'flex', flexDirection: 'column', padding: '20px', backgroundColor: '#eef2f5', overflowY: 'hidden' };
const headerStyle = { margin: '0 0 15px 0', fontSize: '1.8rem', fontWeight: '800', color: '#333', borderBottom: '3px solid #333', paddingBottom: '10px' };

const menuListStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    overflowY: 'auto',
    paddingRight: '5px',
    paddingBottom: '20px'
};

const menuCardStyle = (isSelected) => ({
    display: 'flex',
    flexDirection: 'column',
    border: isSelected ? '2px solid #007bff' : '1px solid #eee',
    backgroundColor: isSelected ? '#f0f9ff' : '#fff',
    borderRadius: '12px',
    padding: '15px 20px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.03)',
    transition: 'all 0.2s',
    minHeight: '70px',
    justifyContent: 'center'
});

const shotOptionContainer = {
    marginTop: '10px',
    padding: '10px',
    backgroundColor: '#e6f3ff',
    borderRadius: '8px',
    border: '1px dashed #b8daff',
    animation: 'fadeIn 0.3s ease-in-out'
};

const orderGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gridAutoRows: 'min-content', alignContent: 'start', gap: '20px', overflowY: 'auto', height: '100%', paddingRight: '5px' };
const receiptCardStyle = { backgroundColor: '#fff', border: '1px solid #ddd', borderTop: '5px solid #d32f2f', borderRadius: '10px', padding: '20px', boxShadow: '0 4px 10px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', minHeight: '200px' };

const circleBtn = { width: '35px', height: '35px', borderRadius: '50%', border: '1px solid #ccc', backgroundColor: '#fff', fontSize: '1.2rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const miniCircleBtn = { width: '28px', height: '28px', borderRadius: '50%', border: '1px solid #007bff', backgroundColor: '#fff', color: '#007bff', fontSize: '1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };

const bigSubmitBtnStyle = { width: '100%', padding: '15px', fontSize: '1.5rem', fontWeight: 'bold', backgroundColor: '#222', color: 'white', border: 'none', borderRadius: '12px', cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,0.2)' };
const payBtnStyle = { padding: '8px 12px', fontSize: '0.9rem', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' };
const cancelBtnStyle = { padding: '8px 12px', fontSize: '0.9rem', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' };
const completedBadgeStyle = { color: 'green', fontWeight: 'bold', border: '2px solid green', padding: '5px 10px', borderRadius: '5px', fontSize: '0.9rem' };
const totalInfoStyle = { marginTop: 'auto', padding: '15px', backgroundColor: '#fff', borderRadius: '10px', border: '2px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '1.4rem', fontWeight: 'bold', marginBottom: '10px' };

// ✅ [신규 스타일] 조리 상태 뱃지
const badgeBase = { padding: '5px 10px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 'bold' };
const cookingBadge = { ...badgeBase, border: '1px solid #ff9800', color: '#ff9800', backgroundColor: '#fff3e0' }; // 주황색 (조리중)
const kitchenDoneBadge = { ...badgeBase, border: '1px solid #007bff', color: '#007bff', backgroundColor: '#e6f2ff' }; // 파란색 (완료됨)

export default OnePersonMode;