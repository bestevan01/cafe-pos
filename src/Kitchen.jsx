import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { socket } from './socket';

function Kitchen() {
    const [orderGroups, setOrderGroups] = useState([]);

    useEffect(() => {
        fetchOrders();

        socket.on('new_order', (newOrderGroup) => {
            setOrderGroups(prev => [newOrderGroup, ...prev]);
        });

        socket.on('order_updated', ({ display_id, is_paid, is_completed }) => {
            // 조리 완료되면 주방 화면에서 삭제
            if (is_completed === 1) {
                setOrderGroups(prev => prev.filter(group => group.display_id !== display_id));
            }
            // 입금 등 다른 상태 변경은 업데이트
            else {
                setOrderGroups(prev => prev.map(group => {
                    if (group.display_id === display_id) {
                        return { ...group, is_paid: is_paid };
                    }
                    return group;
                }));
            }
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

    const fetchOrders = async () => {
        const res = await axios.get('/api/orders');
        const grouped = groupOrdersById(res.data);
        setOrderGroups(grouped);
    };

    // [수정] 데이터 정리할 때, 이미 조리된 건 미리 빼버리는 로직 추가
    const groupOrdersById = (flatList) => {
        const map = {};
        flatList.forEach(item => {
            // ✅ [핵심 수정] 조리가 완료된(is_completed === 1) 주문은 아예 화면에 담지 않음
            if (item.is_completed === 1) return;

            const id = item.daily_number;
            if (!map[id]) {
                map[id] = {
                    daily_number: item.daily_number,
                    display_id: item.display_id,
                    is_paid: item.is_paid,
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

    const handleComplete = async (displayId) => {
        if (!window.confirm("조리를 완료 처리하시겠습니까?")) return;
        try {
            await axios.patch(`/api/orders/${displayId}/complete_kitchen`);
        } catch (err) {
            alert("처리 실패");
        }
    };

    const handleDelete = async (displayId) => {
        if (!window.confirm("⚠️ 주문을 취소하시겠습니까?")) return;
        try {
            await axios.delete(`/api/orders/${displayId}`);
        } catch (err) {
            alert("삭제 실패");
        }
    };

    return (
        <div style={containerStyle}>
            <h2 style={headerStyle}>👨‍🍳 음료 제조 리스트</h2>

            <div style={orderGridStyle}>
                <AnimatePresence>
                    {/* ✅ [수정] map 안의 if문을 제거하고 깔끔하게 렌더링만 수행 */}
                    {orderGroups.map((group) => (
                        <motion.div
                            key={group.daily_number}
                            style={receiptCardStyle}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.2 } }}
                            layout
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px dashed #ddd', paddingBottom: '10px', marginBottom: '10px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <h1 style={{ margin: 0, color: '#d32f2f', fontSize: '2.5rem' }}>
                                        #{String(group.daily_number).padStart(3, '0')}
                                    </h1>
                                </div>

                                <div style={{ textAlign: 'right' }}>
                                    {group.is_paid === 1 ? (
                                        <span style={paidBadgeStyle}>입금 완료 💰</span>
                                    ) : (
                                        <span style={unpaidBadgeStyle}>미입금 ⚠️</span>
                                    )}
                                </div>
                            </div>

                            <div style={{ flex: 1, overflowY: 'auto', marginBottom: '15px' }}>
                                {group.items.map((item, idx) => (
                                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '1.2rem', marginBottom: '8px', borderBottom: '1px solid #f0f0f0', paddingBottom: '5px' }}>
                                        <span style={{color: '#333'}}>{item.menu_name}</span>
                                        <span style={{ fontWeight: 'bold', color: 'black', fontSize: '1.3rem' }}>
                                            {item.quantity}
                                        </span>
                                    </div>
                                ))}
                            </div>

                            <div style={{ display: 'flex', gap: '10px', marginTop: 'auto' }}>
                                <button
                                    onClick={() => handleDelete(group.display_id)}
                                    style={cancelBtnStyle}
                                >
                                    취소
                                </button>
                                <button
                                    onClick={() => handleComplete(group.display_id)}
                                    style={completeBtnStyle}
                                >
                                    조리 완료 ✅
                                </button>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
}

// --- 스타일 정의 ---
const containerStyle = {
    width: '100vw', height: '100vh', backgroundColor: '#222', padding: '20px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column'
};
const headerStyle = {
    margin: '0 0 20px 0', fontSize: '2rem', fontWeight: '800', color: '#fff', borderBottom: '3px solid #555', paddingBottom: '15px'
};
const orderGridStyle = {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gridAutoRows: 'min-content', alignItems: 'start', gap: '20px', overflowY: 'auto', height: '100%', paddingRight: '5px'
};
const receiptCardStyle = {
    backgroundColor: '#fff', border: '1px solid #ddd', borderTop: '6px solid #d32f2f', borderRadius: '12px', padding: '20px', boxShadow: '0 4px 15px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column'
};
const completeBtnStyle = {
    flex: 2, padding: '15px', fontSize: '1.2rem', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold'
};
const cancelBtnStyle = {
    flex: 1, padding: '15px', fontSize: '1rem', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold'
};
const paidBadgeStyle = {
    color: 'green', fontWeight: 'bold', border: '2px solid green', padding: '5px 10px', borderRadius: '5px', fontSize: '0.9rem'
};
const unpaidBadgeStyle = {
    color: 'orange', fontWeight: 'bold', border: '2px solid orange', padding: '5px 10px', borderRadius: '5px', fontSize: '0.9rem'
};

export default Kitchen;