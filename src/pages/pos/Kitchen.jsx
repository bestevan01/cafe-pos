import {useState, useEffect} from 'react';
import {motion, AnimatePresence} from 'framer-motion';
import axios from 'axios';
import {socket} from '../../utils/socket';
import {useNotification} from '../../hooks/useNotification';

function Kitchen({onBack}) {
    const {notify, confirm} = useNotification();
    // ---------------------------------------------------------
    // [1] 상태 관리 (State)
    // ---------------------------------------------------------
    const [orderGroups, setOrderGroups] = useState([]);

    // ---------------------------------------------------------
    // [2] API 및 소켓 통신
    // ---------------------------------------------------------
    const getAuthHeader = () => ({
        headers: {Authorization: `Bearer ${localStorage.getItem('token')}`}
    });

    useEffect(() => {
        void fetchOrders();

        // 실시간 주문 수신
        socket.on('new_order', (newOrderGroup) => {
            setOrderGroups(prev => [newOrderGroup, ...prev]);
        });

        // 주문 상태 업데이트 (결제완료 or 조리완료)
        socket.on('order_updated', ({display_id, is_paid, is_completed}) => {
            if (is_completed === 1) {
                // 조리 완료 시 목록에서 제거
                setOrderGroups(prev => prev.filter(group => group.display_id !== display_id));
            } else {
                // 결제 상태 변경 시 업데이트
                setOrderGroups(prev => prev.map(group => {
                    if (group.display_id === display_id) {
                        return {...group, is_paid: is_paid};
                    }
                    return group;
                }));
            }
        });

        // 주문 취소/삭제 수신
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
        try {
            const res = await axios.get('/api/orders', getAuthHeader());
            const grouped = groupOrdersById(res.data);
            setOrderGroups(grouped);
        } catch (err) {
            notify("주문 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.", {icon: '⚠️', dedupeKey: 'load-kitchen'});
        }
    };

    // DB에서 온 평문 데이터를 주문 번호별로 그룹화
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

    // ---------------------------------------------------------
    // [3] 이벤트 핸들러
    // ---------------------------------------------------------
    const handleComplete = async (displayId) => {
        if (!(await confirm("조리를 완료 처리하시겠습니까?", {confirmText: "완료"}))) return;
        try {
            await axios.patch(`/api/orders/${displayId}/complete_kitchen`, {}, getAuthHeader());
        } catch (err) {
            notify("처리 실패", {icon: '⚠️'});
        }
    };

    const handleDelete = async (displayId) => {
        if (!(await confirm("주문을 취소하시겠습니까?", {title: "⚠️ 주문 취소", confirmText: "주문 취소", danger: true}))) return;
        try {
            await axios.delete(`/api/orders/${displayId}`, getAuthHeader());
        } catch (err) {
            notify("삭제 실패", {icon: '⚠️'});
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
                .receipt-item { display: flex; justify-content: space-between; align-items: center; font-size: 1.2rem; margin-bottom: 8px; border-bottom: 1px solid var(--border-color, #f0f0f0); padding-bottom: 5px; color: var(--text-primary, #333); }
                .item-qty { font-weight: bold; color: var(--text-primary, #111); font-size: 1.3rem; }
                
                /* 액션 버튼 그룹 */
                .btn-group { display: flex; gap: 10px; margin-top: 15px; }
                .btn-cancel { flex: 1; padding: 15px; font-size: 1.1rem; background-color: var(--danger); color: white; border: none; border-radius: var(--radius-md); cursor: pointer; font-weight: bold; transition: opacity 0.2s; }
                .btn-complete { flex: 2; padding: 15px; font-size: 1.2rem; background-color: var(--success); color: white; border: none; border-radius: var(--radius-md); cursor: pointer; font-weight: bold; transition: opacity 0.2s; }
                .btn-cancel:active, .btn-complete:active { opacity: 0.8; }

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
                <AnimatePresence>
                    <>
                        {orderGroups.map((group) => (
                            <motion.div
                                key={group.daily_number}
                                className="receipt-card"
                                initial={{opacity: 0, scale: 0.9}}
                                animate={{opacity: 1, scale: 1}}
                                exit={{opacity: 0, scale: 0.5, transition: {duration: 0.2}}}
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

                                <div style={{flex: 1, overflowY: 'auto', marginBottom: '5px'}}>
                                    {group.items.map((item, idx) => (
                                        <div key={idx} className="receipt-item">
                                        <span
                                            style={{color: item.menu_name.includes('(샷') ? 'var(--accent)' : 'inherit'}}>
                                            {item.menu_name}
                                        </span>
                                            <span className="item-qty">{item.quantity}</span>
                                        </div>
                                    ))}
                                </div>

                                <div className="btn-group">
                                    <button onClick={() => handleDelete(group.display_id)} className="btn-cancel">취소
                                    </button>
                                    <button onClick={() => handleComplete(group.display_id)} className="btn-complete">조리
                                        완료 ✅
                                    </button>
                                </div>
                            </motion.div>
                        ))}</>
                </AnimatePresence>

                {orderGroups.length === 0 && (
                    <p style={{
                        textAlign: 'center',
                        color: 'var(--text-secondary, #888)',
                        marginTop: '50px',
                        fontSize: '1.2rem',
                        gridColumn: '1 / -1'
                    }}>
                        현재 대기 중인 주문이 없습니다. ☕
                    </p>
                )}
            </div>
        </div>
    );
}

export default Kitchen;