import {useState} from 'react';
import SalesDashboard from './SalesDashboard';
import SettlementDashboard from './SettlementDashboard';
import MenuDashboard from './MenuDashboard';
import EventDashboard from './EventDashboard';
import UsersDashboard from './UsersDashboard';
import ThemeToggle from '../../components/ThemeToggle';
import {socket} from '../../utils/socket';
import {useNotification} from '../../hooks/useNotification';

function AdminDashboard({onLogout, onEditProfile}) {
    const [view, setView] = useState('home');
    const {notify, confirm} = useNotification();

    // 데드 스위치: 캐셔 잠금이 꼬여 아무도 접속하지 못할 때 강제 해제
    const handleForceReleaseCashier = async () => {
        const ok = await confirm(
            "현재 정상적으로 캐셔를 사용 중인 직원이 있다면 충돌할 수 있습니다.\n" +
            "캐셔 자리가 멈춰서 아무도 접속하지 못할 때만 사용하세요.",
            {title: "🚨 캐셔 잠금 강제 해제", confirmText: "강제 해제", danger: true}
        );
        if (!ok) return;

        socket.emit('force_release_cashier', (res) => {
            if (res?.success) notify("캐셔 잠금을 해제했습니다. 이제 직원이 캐셔로 접속할 수 있습니다.", {icon: "✅"});
            else notify("해제 실패: " + (res?.message || "알 수 없는 오류"), {icon: "⚠️"});
        });
    };

    // 화면 전환 라우팅
    if (view === 'sales') return <SalesDashboard onBack={() => setView('home')}/>;
    if (view === 'settlement') return <SettlementDashboard onBack={() => setView('home')}/>;
    if (view === 'menu') return <MenuDashboard onBack={() => setView('home')}/>;
    if (view === 'event') return <EventDashboard onBack={() => setView('home')}/>;
    if (view === 'users') return <UsersDashboard onBack={() => setView('home')}/>;

    // 메인(Home) 화면 렌더링
    return (
        <div className="admin-container">
            {/* 상단 우측 헤더 영역 */}
            <div className="top-right-header">
                <ThemeToggle/>
                <button onClick={onEditProfile} className="btn-global btn-profile">
                    ⚙️ 내 정보
                </button>
                <button onClick={onLogout} className="btn-global btn-logout">
                    로그아웃
                </button>
            </div>

            <style>
                {`
                /* 전체 레이아웃 */
                .admin-container {
                    padding: 20px;
                    background-color: var(--bg-color, #f4f6f8);
                    min-height: 100vh;
                    display: flex; flex-direction: column;
                    transition: background-color 0.3s ease;
                    box-sizing: border-box;
                    position: relative; 
                }
                .home-content { 
                    flex: 1; display: flex; flex-direction: column; 
                    align-items: center; justify-content: center; 
                }

                /* 상단 버튼 스타일 */
                .top-right-header {
                    position: absolute; top: 15px; right: 20px;
                    display: flex; gap: 10px; align-items: center; z-index: 100;
                }
                .btn-global {
                    padding: 8px 12px; color: white; border: none;
                    border-radius: var(--radius-md); font-weight: bold;
                    cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                    transition: transform 0.1s; white-space: nowrap;
                }
                .btn-global:active { transform: scale(0.95); }
                .btn-profile { background-color: #495057; }
                .btn-logout { background-color: #dc3545; }

                /* 대시보드 카드 그리드 */
                .admin-grid { 
                    display: grid; grid-template-columns: repeat(3, 1fr); 
                    gap: 25px; width: 100%; max-width: 1000px; margin-bottom: 50px; 
                }
                .admin-card { 
                    background-color: var(--card-bg, white); 
                    border: 1px solid var(--border-color, transparent);
                    border-radius: var(--radius-lg); 
                    padding: 35px 20px; 
                    box-shadow: 0 10px 25px rgba(0,0,0,0.05); 
                    cursor: pointer; display: flex; flex-direction: column; align-items: center; 
                    text-align: center; transition: transform 0.1s, box-shadow 0.1s, background-color 0.3s; 
                }
                .admin-card:active { transform: scale(0.96); box-shadow: 0 5px 15px rgba(0,0,0,0.05); }
                .card-icon { font-size: 3.5rem; margin-bottom: 15px; }
                .card-title { font-size: 1.3rem; font-weight: bold; color: var(--text-primary, #333); margin-bottom: 8px; }
                .card-desc { font-size: 0.95rem; color: var(--text-secondary, #888); word-break: keep-all; }

                /* 비상용 캐셔 강제 해제 버튼 */
                .btn-force-release {
                    padding: 12px 20px; background-color: transparent;
                    color: #dc3545; border: 1px solid #dc3545; border-radius: var(--radius-md);
                    font-weight: bold; font-size: 0.95rem; cursor: pointer;
                    transition: background-color 0.2s, transform 0.1s;
                }
                .btn-force-release:hover { background-color: rgba(220,53,69,0.08); }
                .btn-force-release:active { transform: scale(0.97); }

                /* 모바일 반응형 */
                @media (max-width: 768px) {
                    .top-right-header { top: 10px; right: 10px; gap: 8px; }
                    .btn-global { padding: 6px 10px; font-size: 0.85rem; }

                    .admin-grid { grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 20px; }
                    .admin-card { aspect-ratio: 1 / 1; justify-content: center; padding: 10px; }
                    .card-icon { font-size: 2.5rem; margin-bottom: 8px; }
                    .card-title { font-size: 1.05rem; margin-bottom: 5px; }
                    .card-desc { font-size: 0.75rem; margin: 0; }
                }
                `}
            </style>

            <div className="home-content">
                <h1 style={{
                    fontSize: '2.2rem', marginBottom: '30px',
                    color: 'var(--text-primary, #333)', textAlign: 'center'
                }}>
                    🛡️ 관리자 대시보드
                </h1>

                <div className="admin-grid">
                    <button onClick={() => setView('sales')} className="admin-card">
                        <div className="card-icon">💸</div>
                        <div className="card-title">매출 통계</div>
                        <div className="card-desc">오늘/월간 매출 확인</div>
                    </button>
                    <button onClick={() => setView('settlement')} className="admin-card">
                        <div className="card-icon">💰</div>
                        <div className="card-title">시재/정산</div>
                        <div className="card-desc">오픈/마감 내역</div>
                    </button>
                    <button onClick={() => setView('menu')} className="admin-card">
                        <div className="card-icon">📋</div>
                        <div className="card-title">메뉴 관리</div>
                        <div className="card-desc">메뉴 추가/품절 변경</div>
                    </button>
                    <button onClick={() => setView('event')} className="admin-card">
                        <div className="card-icon">🎉</div>
                        <div className="card-title">이벤트 관리</div>
                        <div className="card-desc">할인/무료 행사 설정</div>
                    </button>
                    <button onClick={() => setView('users')} className="admin-card">
                        <div className="card-icon">👥</div>
                        <div className="card-title">직원 관리</div>
                        <div className="card-desc">가입 승인 및 권한 설정</div>
                    </button>
                </div>

                {/* 운영 도구: 캐셔 잠금이 꼬였을 때 비상 해제 */}
                <button onClick={handleForceReleaseCashier} className="btn-force-release">
                    🚨 캐셔 강제 해제 (비상용)
                </button>
            </div>
        </div>
    );
}

export default AdminDashboard;