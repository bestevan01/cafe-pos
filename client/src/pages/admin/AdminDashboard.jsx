import SalesDashboard from './SalesDashboard';
import SettlementDashboard from './SettlementDashboard';
import MenuDashboard from './MenuDashboard';
import EventDashboard from './EventDashboard';
import UsersDashboard from './UsersDashboard';
import CostAnalysis from './CostAnalysis';
import HygieneDashboard from './HygieneDashboard';
import InventoryDashboard from './InventoryDashboard';
import StoreBadge from '../../components/StoreBadge';
import AdminUserMenu, { AdminMenuProvider } from '../../components/AdminUserMenu';
import { useAdminView } from '../../hooks/useAdminView';

/**
 * @param {object} props
 * @param {string} props.userName
 * @param {() => void} props.onLogout
 * @param {() => void} props.onEditProfile
 * @param {() => void} props.onEnterStaffMode  캐셔/주방 화면으로 전환
 * @param {() => void} props.onOpenAlerts  알림 설정 열기
 */
function AdminDashboard(props) {
    return (
        <AdminMenuProvider {...props}>
            <AdminScreens />
        </AdminMenuProvider>
    );
}

function AdminScreens() {
    // 알림 설정 등에 다녀와도 보던 화면이 그대로 열리도록 컴포넌트 밖에 기억한다(hooks/useAdminView.js).
    const [view, setView] = useAdminView('dashboard', 'home');

    // 화면 전환 라우팅
    if (view === 'sales') return <SalesDashboard onBack={() => setView('home')} />;
    if (view === 'settlement') return <SettlementDashboard onBack={() => setView('home')} />;
    if (view === 'menu') return <MenuDashboard onBack={() => setView('home')} />;
    if (view === 'event') return <EventDashboard onBack={() => setView('home')} />;
    if (view === 'users') return <UsersDashboard onBack={() => setView('home')} />;
    if (view === 'cost') return <CostAnalysis onBack={() => setView('home')} />;
    if (view === 'hygiene') return <HygieneDashboard onBack={() => setView('home')} />;
    if (view === 'inventory') return <InventoryDashboard onBack={() => setView('home')} />;

    // 메인(Home) 화면 렌더링
    return (
        <div className="admin-container">
            {/* 상단 우측 헤더 영역 — 이름 드롭다운 하나로 PC/모바일 공통 */}
            <div className="top-right-header">
                <AdminUserMenu showName />
            </div>

            <style>
                {`
                /* 전체 레이아웃 */
                /* 화면 높이에 가둬 두고, 넘치는 것은 카드 그리드 안에서만 스크롤시킨다.
                   그래야 매장 배지·제목·이름 메뉴가 스크롤에 딸려 올라가지 않는다.
                   폭이 아니라 '내용이 넘치는지'로 결정되므로 폰·태블릿·PC를 따로 나눌 필요가 없다
                   (아이패드 미니 가로 1133×744처럼 넓지만 낮은 화면도 여기에 걸린다). */
                .admin-container {
                    padding: 20px;
                    background-color: var(--bg-color, #f4f6f8);
                    height: 100dvh;
                    display: flex; flex-direction: column;
                    transition: background-color 0.3s ease;
                    box-sizing: border-box;
                    position: relative; 
                }
                .home-content {
                    flex: 1; min-height: 0; display: flex; flex-direction: column;
                    align-items: center; justify-content: center;
                }
                /* margin-top을 0으로 명시 — 비워두면 브라우저 기본값 h1 { margin: 0.67em 0 }이 남는다(역할 선택 화면과 동일) */
                .admin-title { font-size: 2.2rem; margin: 0 0 32px; color: var(--text-primary, #333); text-align: center; }

                /* 상단 버튼 스타일 */
                .top-right-header {
                    position: absolute; top: 15px; right: 20px;
                    display: flex; gap: 10px; align-items: center; z-index: 100;
                }

                /* 대시보드 카드 그리드 */
                /* min-height: 0이 있어야 flex 자식이 내용 높이 아래로 줄어들어 스크롤이 생긴다.
                   flex: 1을 주지 않는 이유: 공간이 넉넉하면 자연 높이로 남아 가운데 정렬이 유지된다. */
                .admin-grid { 
                    display: grid; grid-template-columns: repeat(3, 1fr); 
                    gap: 25px; width: 100%; max-width: 1000px; margin-bottom: 50px;
                    min-height: 0; overflow-y: auto;
                }
                .admin-card { 
                    background-color: var(--card-bg, white); 
                    border: 1px solid var(--border-color, transparent);
                    border-radius: var(--radius-lg); 
                    padding: 35px 20px; 
                    box-shadow: var(--shadow-lg);
                    cursor: pointer; display: flex; flex-direction: column; align-items: center;
                    text-align: center; transition: transform 0.1s, box-shadow 0.1s, background-color 0.3s; 
                }
                .admin-card:active { transform: scale(0.96); box-shadow: var(--shadow-md); }
                .card-icon { font-size: 3.5rem; margin-bottom: 15px; }
                .card-title { font-size: 1.3rem; font-weight: bold; color: var(--text-primary, #333); margin-bottom: 8px; }
                .card-desc { font-size: 0.95rem; color: var(--text-secondary, #888); word-break: keep-all; }

                /* 모바일 반응형 — 메뉴 형태(드롭다운)는 PC와 동일, 배치만 좁은 화면에 맞춤 */
                @media (max-width: 768px) {
                    /* 헤더를 절대배치 → 흐름 안(상단 바)으로: 가운데 정렬된 타이틀이 좁은 화면에서 버튼과 겹치지 않게 함 */
                    .top-right-header { position: static; justify-content: flex-end; margin-bottom: 10px; }
                    /* 좁은 화면에서는 가운데 정렬 대신 위에서부터 흐르게 한다. */
                    .home-content { justify-content: flex-start; }
                    .admin-title { font-size: 1.6rem; margin: 0 0 20px; }

                    .admin-grid {
                        grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 0;
                        flex: 1;
                        /* 카드 크기는 화면 높이와 무관하게 고정하고, 넘치면 목록처럼 스크롤한다.
                           148px는 설명이 두 줄인 카드(원가/순익 분석·위생 점검)의 자연 높이.
                           minmax(…, auto)로 둬서 나중에 설명이 더 길어져도 잘리지 않는다.
                           align-content: start가 없으면 남는 공간만큼 행이 늘어나 고정 높이가 무의미해진다. */
                        align-content: start; grid-auto-rows: minmax(148px, auto);
                    }
                    .admin-card { aspect-ratio: auto; justify-content: center; padding: 16px 10px; }
                    .card-icon { font-size: 2.4rem; margin-bottom: 8px; }
                    .card-title { font-size: 1.05rem; margin-bottom: 5px; }
                    .card-desc { font-size: 0.75rem; margin: 0; }
                }
                `}
            </style>

            <div className="home-content">
                <StoreBadge />
                <h1 className="admin-title">🛡️ 관리자 대시보드</h1>

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
                    <button onClick={() => setView('cost')} className="admin-card">
                        <div className="card-icon">🧮</div>
                        <div className="card-title">원가/순익 분석</div>
                        <div className="card-desc">원재료·레시피로 잔당 마진 계산</div>
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
                    <button onClick={() => setView('hygiene')} className="admin-card">
                        <div className="card-icon">🧼</div>
                        <div className="card-title">위생 점검</div>
                        <div className="card-desc">점검 기록 확인 및 점검 설정</div>
                    </button>
                    <button onClick={() => setView('inventory')} className="admin-card">
                        <div className="card-icon">📦</div>
                        <div className="card-title">재고 현황</div>
                        <div className="card-desc">주문 필요 품목 확인 및 품목 관리</div>
                    </button>
                </div>
            </div>
        </div>
    );
}

export default AdminDashboard;
