// TODO: 다크 / 라이트 / 시스템 테마 제작 및 적용

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { socket } from '../../utils/socket';

function Kitchen({ onBack }) {
    const [orderGroups, setOrderGroups] = useState([]);

    useEffect(() => {
        fetchOrders();

        socket.on('new_order', (newOrderGroup) => {
            setOrderGroups(prev => [newOrderGroup, ...prev]);
        });

        socket.on('order_updated', ({ display_id, is_paid, is_completed }) => {
            if (is_completed === 1) {
                setOrderGroups(prev => prev.filter(group => group.display_id !== display_id));
            } else {
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

    const groupOrdersById = (flatList) => {
        const map = {};
        flatList.forEach(item => {
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
        <div className="kitchen-container">
            <style>
                {`
                .kitchen-container {
                    display: flex; flex-direction: column; width: 100vw; height: 100vh; height: 100dvh;
                    background-color: var(--bg-color, #f4f6f8); padding: 20px; box-sizing: border-box;
                    transition: background-color 0.3s ease;
                }
                
                .kitchen-header-bar {
                    display: flex; align-items: center; gap: 20px; border-bottom: 3px solid var(--text-primary, #333);
                    padding-bottom: 15px; margin-bottom: 20px; flex-wrap: wrap;
                }
                
                .btn-back {
                    padding: 10px 15px; font-size: 0.95rem; font-weight: bold; background-color: #6c757d; 
                    color: white; border: none; border-radius: 8px; cursor: pointer; transition: transform 0.1s;
                }
                .btn-back:active { transform: scale(0.95); }
                
                .kitchen-title { margin: 0; font-size: 2rem; font-weight: 800; color: var(--text-primary, #333); }
                
                .order-grid {
                    display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
                    align-items: start; gap: 20px; overflow-y: auto; height: 100%; 
                    padding-right: 5px; scrollbar-width: thin; align-content: start;
                }
                
                .receipt-card {
                    background-color: var(--card-bg, #fff); border: 1px solid var(--border-color, #ddd);
                    border-top: 6px solid #d32f2f; border-radius: 12px; padding: 20px;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.08); display: flex; flex-direction: column;
                }
                
                .receipt-header {
                    display: flex; justify-content: space-between; align-items: center;
                    border-bottom: 2px dashed var(--border-color, #ddd); padding-bottom: 10px; margin-bottom: 10px;
                }
                
                .receipt-num { margin: 0; color: #d32f2f; font-size: 2.5rem; font-weight: bold; }
                
                .badge-paid { color: #28a745; border: 2px solid #28a745; padding: 6px 12px; border-radius: 6px; font-size: 0.9rem; font-weight: bold; background-color: rgba(40,167,69,0.1); }
                .badge-unpaid { color: #ff9800; border: 2px solid #ff9800; padding: 6px 12px; border-radius: 6px; font-size: 0.9rem; font-weight: bold; background-color: rgba(255,152,0,0.1); }
                
                .receipt-item { display: flex; justify-content: space-between; align-items: center; font-size: 1.2rem; margin-bottom: 8px; border-bottom: 1px solid var(--border-color, #f0f0f0); padding-bottom: 5px; color: var(--text-primary, #333); }
                .item-qty { font-weight: bold; color: var(--text-primary, #111); font-size: 1.3rem; }
                
                .btn-group { display: flex; gap: 10px; margin-top: 15px; }
                .btn-cancel { flex: 1; padding: 15px; font-size: 1.1rem; background-color: #dc3545; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; transition: opacity 0.2s; }
                .btn-cancel:active { opacity: 0.8; }
                .btn-complete { flex: 2; padding: 15px; font-size: 1.2rem; background-color: #28a745; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; transition: opacity 0.2s; }
                .btn-complete:active { opacity: 0.8; }

                /* 📱 모바일 화면 최적화 (768px 이하) */
                @media (max-width: 768px) {
                    .kitchen-container { 
                        padding: 15px; 
                        padding-top: 65px; /* 🌟 핵심: 상단 글로벌 버튼(내 정보 등)과의 겹침 방지 */
                    } 
                    .kitchen-header-bar { flex-direction: column; align-items: flex-start; gap: 12px; }
                    .kitchen-title { font-size: 1.6rem; }
                    .order-grid { grid-template-columns: 1fr; } /* 모바일에서는 1줄 꽉 차게 */
                    .receipt-num { font-size: 2rem; }
                }
                `}
            </style>

            <div className="kitchen-header-bar">
                <button onClick={onBack} className="btn-back">⬅ 나가기</button>
                <h1 className="kitchen-title">👨‍🍳 음료 제조 리스트</h1>
            </div>

            <div className="order-grid">
                <AnimatePresence>
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
                                    {group.is_paid === 1
                                        ? <span className="badge-paid">입금 완료 💰</span>
                                        : <span className="badge-unpaid">미입금 ⚠️</span>
                                    }
                                </div>
                            </div>

                            <div style={{ flex: 1, overflowY: 'auto', marginBottom: '5px' }}>
                                {group.items.map((item, idx) => (
                                    <div key={idx} className="receipt-item">
                                        <span style={{color: item.menu_name.includes('샷추가') ? '#007bff' : 'inherit'}}>{item.menu_name}</span>
                                        <span className="item-qty">{item.quantity}</span>
                                    </div>
                                ))}
                            </div>

                            <div className="btn-group">
                                <button onClick={() => handleDelete(group.display_id)} className="btn-cancel">
                                    취소
                                </button>
                                <button onClick={() => handleComplete(group.display_id)} className="btn-complete">
                                    조리 완료 ✅
                                </button>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
                {orderGroups.length === 0 && (
                    <p style={{textAlign: 'center', color: 'var(--text-secondary, #888)', marginTop: '50px', fontSize: '1.2rem', gridColumn: '1 / -1'}}>
                        현재 대기 중인 주문이 없습니다. ☕
                    </p>
                )}
            </div>
        </div>
    );
}

export default Kitchen;