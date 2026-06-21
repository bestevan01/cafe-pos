import {useState, useEffect} from 'react';
import axios from 'axios';
import ThemeToggle from '../../components/ThemeToggle';
import Button from '../../components/ui/Button';
import {useNotification} from '../../hooks/useNotification';

function EventDashboard({onBack}) {
    const {notify, confirm} = useNotification();
    // ---------------------------------------------------------
    // [1] 상태 관리
    // ---------------------------------------------------------
    const [events, setEvents] = useState([]);
    const [menuList, setMenuList] = useState([]); // 🌟 판매 중인 메뉴 목록 저장

    const [newEventName, setNewEventName] = useState('');
    const [newEventType, setNewEventType] = useState('free');
    const [newDiscountAmount, setNewDiscountAmount] = useState('');

    // 하루 한정 수량 상태
    const [hasDailyLimit, setHasDailyLimit] = useState(false);
    const [dailyLimitQty, setDailyLimitQty] = useState('');

    // 🌟 특정 메뉴 적용 상태
    const [hasTargetMenu, setHasTargetMenu] = useState(false);
    const [selectedMenus, setSelectedMenus] = useState([]);

    const getAuthHeader = () => ({
        headers: {Authorization: `Bearer ${localStorage.getItem('token')}`}
    });

    // ---------------------------------------------------------
    // [2] 초기화 (데이터 불러오기)
    // ---------------------------------------------------------
    useEffect(() => {
        void fetchEvents();
        void fetchMenus();
    }, []);

    const fetchEvents = async () => {
        try {
            const res = await axios.get('/api/events', getAuthHeader());
            setEvents(res.data);
        } catch (err) {
            notify("이벤트 화면 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.", {icon: '⚠️', dedupeKey: 'load-event'});
        }
    };

    const fetchMenus = async () => {
        try {
            const res = await axios.get('/api/menu', getAuthHeader());
            setMenuList(res.data);
        } catch (err) {
            notify("이벤트 화면 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.", {icon: '⚠️', dedupeKey: 'load-event'});
        }
    };

    // ---------------------------------------------------------
    // [3] 핸들러 함수
    // ---------------------------------------------------------

    // 🌟 메뉴 버튼 클릭 시 선택/해제 토글
    const handleMenuSelect = (menuName) => {
        if (selectedMenus.includes(menuName)) {
            setSelectedMenus(selectedMenus.filter(name => name !== menuName));
        } else {
            setSelectedMenus([...selectedMenus, menuName]);
        }
    };

    const handleAddEvent = async () => {
        if (!newEventName.trim()) return notify("이벤트 이름을 입력해주세요!", {icon: '⚠️'});
        if (newEventType === 'discount' && (!newDiscountAmount || newDiscountAmount <= 0)) {
            return notify("할인 금액을 올바르게 입력해주세요!", {icon: '⚠️'});
        }
        if (hasDailyLimit && (!dailyLimitQty || dailyLimitQty <= 0)) {
            return notify("제한 수량을 올바르게 입력해주세요!", {icon: '⚠️'});
        }
        if (hasTargetMenu && selectedMenus.length === 0) {
            return notify("적용할 메뉴를 최소 1개 이상 선택해주세요!", {icon: '⚠️'});
        }

        const newEventData = {
            name: newEventName,
            type: newEventType,
            discount_amount: newEventType === 'free' ? 0 : Number(newDiscountAmount),
            daily_limit: hasDailyLimit ? Number(dailyLimitQty) : null,
            target_menus: hasTargetMenu ? JSON.stringify(selectedMenus) : 'all',
            is_active: false
        };

        try {
            const res = await axios.post('/api/events', newEventData, getAuthHeader());
            if (res.data.success) {
                await fetchEvents();
                setNewEventName('');
                setNewDiscountAmount('');
                setHasDailyLimit(false);
                setDailyLimitQty('');
                setHasTargetMenu(false);
                setSelectedMenus([]); // 폼 초기화
            }
        } catch (err) {
            notify("이벤트 등록에 실패했습니다.", {icon: '⚠️'});
        }
    };

    const toggleEventStatus = async (id) => {
        const targetEvent = events.find(ev => ev.id === id);
        if (!targetEvent) return;
        try {
            await axios.patch(`/api/events/${id}/toggle`, {is_active: !targetEvent.is_active}, getAuthHeader());
            await fetchEvents();
        } catch (err) {
            notify("상태 변경에 실패했습니다.", {icon: '⚠️'});
        }
    };

    const handleDelete = async (id) => {
        if (!(await confirm("이 이벤트를 정말 삭제하시겠습니까?", {title: "이벤트 삭제", confirmText: "삭제", danger: true}))) return;
        try {
            await axios.delete(`/api/events/${id}`, getAuthHeader());
            await fetchEvents();
        } catch (err) {
            notify("삭제에 실패했습니다.", {icon: '⚠️'});
        }
    };

    // 리스트 화면에 보여줄 메뉴 이름 요약 함수
    const renderTargetMenus = (target_menus) => {
        if (!target_menus || target_menus === 'all') return '전체 메뉴';
        try {
            const parsed = JSON.parse(target_menus);
            if (parsed.length > 2) return `${parsed[0]}, ${parsed[1]} 외 ${parsed.length - 2}개`;
            return parsed.join(', ');
        } catch (e) {
            return target_menus;
        }
    };

    // ---------------------------------------------------------
    // [4] 렌더링
    // ---------------------------------------------------------
    return (
        <div className="event-dashboard-container">
            <style>
                {`
                .event-dashboard-container { padding: 20px; background-color: var(--bg-color); min-height: 100dvh; box-sizing: border-box; transition: background-color 0.3s ease, color 0.3s ease; }
                .header-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 30px; }
                .header-left { display: flex; align-items: center; gap: 15px; }
                .page-title { margin: 0; font-size: 1.8rem; color: var(--text-primary); }

                .add-event-card { background-color: var(--card-bg); padding: 20px; border-radius: var(--radius-lg); box-shadow: 0 4px 15px rgba(0,0,0,0.05); margin-bottom: 30px; border: 1px solid var(--border-color); transition: background-color 0.3s ease, border-color 0.3s ease; }
                .form-row { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 15px; }
                
                .form-input { flex: 1; min-width: 200px; padding: 12px; border-radius: var(--radius-md); border: 1px solid var(--border-color); background-color: var(--bg-color); color: var(--text-primary); font-size: 1rem; box-sizing: border-box; transition: background-color 0.3s ease, border-color 0.3s ease; }
                .form-select { flex: 0 1 220px; padding: 12px; border-radius: var(--radius-md); border: 1px solid var(--border-color); background-color: var(--bg-color); color: var(--text-primary); font-size: 1rem; box-sizing: border-box; transition: background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease; }
                
                .checkbox-label { display: flex; align-items: center; gap: 8px; cursor: pointer; color: var(--text-primary); font-weight: bold; font-size: 0.95rem; margin: 0; }
                

                /* 🌟 메뉴 선택 뱃지 스타일 */
                .menu-pill-box { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; padding: 15px; background-color: var(--bg-color); border-radius: var(--radius-md); border: 1px dashed var(--border-color); width: 100%; box-sizing: border-box; animation: slideDown 0.2s ease-out; }
                @keyframes slideDown { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
                
                .menu-pill { padding: 8px 12px; border: 1px solid var(--border-color); border-radius: 20px; background-color: var(--card-bg); color: var(--text-secondary); cursor: pointer; font-size: 0.9rem; transition: all 0.2s ease; user-select: none; }
                .menu-pill.selected { background-color: var(--accent-bg); border-color: var(--accent); color: var(--accent); font-weight: bold; }

                /* 이벤트 리스트 */
                .event-list { display: flex; flex-direction: column; gap: 15px; }
                .event-item { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px; padding: 20px; background-color: var(--card-bg); border-radius: var(--radius-lg); border: 1px solid var(--border-color); box-shadow: 0 2px 8px rgba(0,0,0,0.03); transition: background-color 0.3s ease, border-color 0.3s ease; }
                .event-info { display: flex; flex-direction: column; gap: 8px; }
                .event-name { font-size: 1.25rem; font-weight: bold; color: var(--text-primary); display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
                .event-desc { font-size: 0.95rem; color: var(--text-secondary); }
                
                .badge { padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: bold; vertical-align: middle; }
                .badge-free { background-color: var(--accent-bg); color: var(--accent); border: 1px solid var(--accent); }
                .badge-discount { background-color: var(--warning-bg); color: var(--warning); border: 1px solid var(--warning); }
                .badge-target { background-color: var(--bg-color); color: var(--text-primary); border: 1px solid var(--border-color); }

                .action-buttons { display: flex; gap: 10px; align-items: center; }
                .btn-toggle { padding: 8px 15px; border: none; border-radius: 20px; font-weight: bold; cursor: pointer; color: white; transition: background-color 0.2s, transform 0.1s; }
                .btn-toggle.active { background-color: var(--success); }
                .btn-toggle.inactive { background-color: var(--neutral); }
                .btn-toggle:active { transform: scale(0.95); }

                @media (max-width: 768px) {
                    .event-item { flex-direction: column; align-items: flex-start; }
                    .action-buttons { width: 100%; justify-content: flex-end; margin-top: 10px; }
                    .form-row { flex-direction: column; align-items: stretch !important; height: auto !important; min-height: auto !important; }
                    .form-select, .form-input { flex: none !important; width: 100% !important; margin-bottom: 5px; }
                    .btn-add { width: 100%; margin-left: 0; margin-top: 5px; }
                    .checkbox-label { margin-bottom: 5px; }
                }
                `}
            </style>

            <div className="header-bar">
                <div className="header-left">
                    <Button variant="neutral" icon="⬅" onClick={onBack}>뒤로</Button>
                    <h1 className="page-title">🎉 이벤트 관리</h1>
                </div>
                <ThemeToggle/>
            </div>

            <div className="add-event-card">
                <h3 style={{marginTop: 0, marginBottom: '15px', color: 'var(--text-primary)'}}>새로운 이벤트 등록</h3>
                <div className="form-row">
                    <input type="text" className="form-input" placeholder="이벤트명 (예: 오픈 기념 선착순 무료)" value={newEventName}
                           onChange={(e) => setNewEventName(e.target.value)}/>
                    <select className="form-select" value={newEventType}
                            onChange={(e) => setNewEventType(e.target.value)}>
                        <option value="free">100% 무료 (0원 처리)</option>
                        <option value="discount">정액 할인 (금액 차감)</option>
                    </select>
                    {newEventType === 'discount' && (
                        <input type="number" className="form-input" style={{flex: '0 1 120px'}} placeholder="할인액"
                               value={newDiscountAmount} onChange={(e) => setNewDiscountAmount(e.target.value)}/>
                    )}
                </div>

                {/* 🌟 특정 메뉴만 적용 체크박스 및 메뉴 선택 창 */}
                <div className="form-row" style={{marginBottom: hasTargetMenu ? '5px' : '15px'}}>
                    <label className="checkbox-label" style={{marginBottom: 0}}>
                        <input
                            type="checkbox"
                            checked={hasTargetMenu}
                            onChange={(e) => setHasTargetMenu(e.target.checked)}
                            style={{width: '18px', height: '18px'}}
                        />
                        일부 메뉴에만 적용 (체크 해제 시 전체 메뉴)
                    </label>
                </div>
                {hasTargetMenu && (
                    <div className="form-row">
                        <div className="menu-pill-box">
                            {menuList.length === 0 ? <span style={{fontSize: '0.9rem', color: 'var(--text-secondary)'}}>메뉴 데이터를 불러오는 중입니다...</span> : null}
                            {menuList.map(menu => (
                                <div
                                    key={menu.id}
                                    className={`menu-pill ${selectedMenus.includes(menu.name) ? 'selected' : ''}`}
                                    onClick={() => handleMenuSelect(menu.name)}
                                >
                                    {selectedMenus.includes(menu.name) ? '✓ ' : '+ '}{menu.name}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 수량 제한 체크박스 및 등록 버튼 */}
                <div className="form-row" style={{
                    marginBottom: 0,
                    minHeight: '46px',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: '10px'
                }}>
                    <div style={{display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap'}}>
                        <label className="checkbox-label" style={{marginBottom: 0}}>
                            <input
                                type="checkbox"
                                checked={hasDailyLimit}
                                onChange={(e) => setHasDailyLimit(e.target.checked)}
                                style={{width: '18px', height: '18px'}}
                            />
                            하루 한정 수량 설정 (선착순)
                        </label>
                        {hasDailyLimit && (
                            <input type="number" className="form-input" style={{flex: '0 1 150px'}}
                                   placeholder="예: 20 (잔/명)" value={dailyLimitQty}
                                   onChange={(e) => setDailyLimitQty(e.target.value)}/>
                        )}
                    </div>
                    <Button onClick={handleAddEvent}>+ 등록</Button>
                </div>
            </div>

            <div className="event-list">
                {events.length === 0 ? (
                    <p style={{textAlign: 'center', color: 'var(--text-secondary)', padding: '30px'}}>등록된 이벤트가 없습니다.</p>
                ) : (
                    events.map(ev => (
                        <div key={ev.id} className="event-item">
                            <div className="event-info">
                                <div className="event-name">
                                    {ev.name}
                                    <span className={`badge ${ev.type === 'free' ? 'badge-free' : 'badge-discount'}`}>
                                        {ev.type === 'free' ? '전액 무료' : `${ev.discount_amount}원 할인`}
                                    </span>
                                    {ev.daily_limit && (
                                        <span className="badge" style={{
                                            backgroundColor: 'var(--danger-bg)',
                                            color: 'var(--danger)',
                                            border: '1px solid var(--danger)'
                                        }}>
                                            🔥 하루 {ev.daily_limit}잔 한정
                                        </span>
                                    )}
                                    <span className="badge badge-target">
                                        🎯 {renderTargetMenus(ev.target_menus)}
                                    </span>
                                </div>
                                <div className="event-desc">
                                    캐셔 화면에서 이 버튼을 누르면 결제
                                    금액이 {ev.type === 'free' ? '0원으로' : `${ev.discount_amount}원 차감되어`} 처리됩니다.
                                </div>
                            </div>

                            <div className="action-buttons">
                                <button onClick={() => toggleEventStatus(ev.id)}
                                        className={`btn-toggle ${ev.is_active ? 'active' : 'inactive'}`}>
                                    {ev.is_active ? '🟢 POS 노출 중' : '⚫ POS 숨김'}
                                </button>
                                <Button variant="danger" size="sm" onClick={() => handleDelete(ev.id)}>삭제</Button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

export default EventDashboard;