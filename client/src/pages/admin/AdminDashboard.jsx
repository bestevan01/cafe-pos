import { useState } from 'react';
import SalesDashboard from './SalesDashboard';
import SettlementDashboard from './SettlementDashboard';
import MenuDashboard from './MenuDashboard';
import EventDashboard from './EventDashboard';
import UsersDashboard from './UsersDashboard';
import CostAnalysis from './CostAnalysis';
import HygieneDashboard from './HygieneDashboard';
import { socket } from '../../utils/socket';
import { useTheme } from '../../hooks/useTheme';
import { useNotification } from '../../hooks/useNotification';
import StoreBadge from '../../components/StoreBadge';

/**
 * @param {object} props
 * @param {string} props.userName
 * @param {() => void} props.onLogout
 * @param {() => void} props.onEditProfile
 * @param {() => void} props.onEnterStaffMode  캐셔/주방 화면으로 전환
 */
function AdminDashboard({ userName, onLogout, onEditProfile, onEnterStaffMode }) {
    const [view, setView] = useState('home');
    const { notify, confirm } = useNotification();
    const { theme, setTheme } = useTheme();
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [isThemeSubOpen, setIsThemeSubOpen] = useState(false);

    // 데드 스위치: 캐셔 잠금이 꼬여 아무도 접속하지 못할 때 강제 해제
    const handleForceReleaseCashier = async () => {
        const ok = await confirm(
            '현재 정상적으로 캐셔를 사용 중인 직원이 있다면 충돌할 수 있습니다.\n' +
                '캐셔 자리가 멈춰서 아무도 접속하지 못할 때만 사용하세요.',
            { title: '🚨 캐셔 잠금 강제 해제', confirmText: '강제 해제', danger: true },
        );
        if (!ok) return;

        socket.emit(
            'force_release_cashier',
            /** @param {any} res */ (res) => {
                if (res?.success)
                    notify('캐셔 잠금을 해제했습니다. 이제 직원이 캐셔로 접속할 수 있습니다.', { icon: '✅' });
                else notify('해제 실패: ' + (res?.message || '알 수 없는 오류'), { icon: '⚠️' });
            },
        );
    };

    // 화면 전환 라우팅
    if (view === 'sales') return <SalesDashboard onBack={() => setView('home')} />;
    if (view === 'settlement') return <SettlementDashboard onBack={() => setView('home')} />;
    if (view === 'menu') return <MenuDashboard onBack={() => setView('home')} />;
    if (view === 'event') return <EventDashboard onBack={() => setView('home')} />;
    if (view === 'users') return <UsersDashboard onBack={() => setView('home')} />;
    if (view === 'cost') return <CostAnalysis onBack={() => setView('home')} />;
    if (view === 'hygiene') return <HygieneDashboard onBack={() => setView('home')} />;

    // 메인(Home) 화면 렌더링
    return (
        <div className="admin-container">
            {/* 상단 우측 헤더 영역 — 이름 드롭다운 하나로 PC/모바일 공통 */}
            <div className="top-right-header">
                <div className="user-menu">
                    <button
                        className="btn-user-dropdown"
                        onClick={() => {
                            setIsDropdownOpen(!isDropdownOpen);
                            setIsThemeSubOpen(false);
                        }}
                    >
                        👤 {userName}님 ▼
                    </button>

                    {isDropdownOpen && (
                        <div className="dropdown-panel">
                            <div className="dropdown-theme-wrap">
                                <button
                                    className="dropdown-item dropdown-theme-toggle"
                                    onClick={() => setIsThemeSubOpen(!isThemeSubOpen)}
                                >
                                    <span>🎨 테마 변경</span>
                                    <span className="dropdown-sub-arrow">‹</span>
                                </button>
                                {isThemeSubOpen && (
                                    <div className="dropdown-submenu">
                                        <button
                                            className={`dropdown-item ${theme === 'light' ? 'active' : ''}`}
                                            onClick={() => setTheme('light')}
                                        >
                                            ☀️ 라이트 모드
                                        </button>
                                        <button
                                            className={`dropdown-item ${theme === 'dark' ? 'active' : ''}`}
                                            onClick={() => setTheme('dark')}
                                        >
                                            🌙 다크 모드
                                        </button>
                                        <button
                                            className={`dropdown-item ${theme === 'system' ? 'active' : ''}`}
                                            onClick={() => setTheme('system')}
                                        >
                                            💻 시스템 설정
                                        </button>
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={() => {
                                    setIsDropdownOpen(false);
                                    onEnterStaffMode();
                                }}
                                className="dropdown-item"
                            >
                                🛒 캐셔/주방 화면
                            </button>
                            <button
                                onClick={() => {
                                    setIsDropdownOpen(false);
                                    onEditProfile();
                                }}
                                className="dropdown-item"
                            >
                                ⚙️ 내 정보
                            </button>
                            <button
                                onClick={() => {
                                    setIsDropdownOpen(false);
                                    handleForceReleaseCashier();
                                }}
                                className="dropdown-item danger"
                            >
                                🚨 캐셔 강제 해제
                            </button>
                            <button
                                onClick={() => {
                                    setIsDropdownOpen(false);
                                    onLogout();
                                }}
                                className="dropdown-item logout"
                            >
                                🚪 로그아웃
                            </button>
                        </div>
                    )}
                </div>
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

                /* 이름 드롭다운 — PC/모바일 공통(화면 크기와 무관하게 동일한 형태) */
                .user-menu { position: relative; }

                .btn-user-dropdown { padding: 6px 12px; border-radius: 20px; border: 1px solid var(--border-color, #ccc); background-color: var(--card-bg, #fff); color: var(--text-primary, #333); font-weight: bold; font-size: 0.85rem; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.1); display: flex; align-items: center; gap: 5px; }

                /* min-width 고정값 대신 가장 긴 항목(캐셔/주방 화면, 캐셔 강제 해제)에 맞춰 너비 자동 결정 */
                .dropdown-panel { position: absolute; top: 110%; right: 0; background-color: var(--card-bg, #fff); border: 1px solid var(--border-color, #ddd); border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); display: flex; flex-direction: column; overflow: visible; width: max-content; z-index: 10000; }

                .dropdown-item { padding: 12px 15px; background: none; border: none; border-bottom: 1px solid var(--border-color, #eee); text-align: left; font-size: 0.9rem; font-weight: bold; color: var(--text-primary, #333); cursor: pointer; transition: background-color 0.2s; white-space: nowrap; }
                .dropdown-item:last-child { border-bottom: none; }
                .dropdown-item.logout, .dropdown-item.danger { color: var(--danger); }
                .dropdown-item:active { background-color: var(--border-color, #f0f0f0); }
                .dropdown-item.active { color: var(--accent); font-weight: 800; }
                .dropdown-theme-wrap { position: relative; }
                /* dropdown-theme-wrap에 한 겹 더 감싸져 있어 flex stretch를 못 받고 내용물 크기로만 줄어들던 문제 수정 */
                /* + 화살표를 오른쪽 끝(space-between)이 아니라 텍스트 바로 옆에 붙임 */
                .dropdown-theme-toggle { display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box; }
                .dropdown-sub-arrow { color: var(--text-secondary, #999); font-size: 1.1rem; line-height: 1; }
                .dropdown-submenu { position: absolute; right: calc(100% + 6px); top: 0; background-color: var(--card-bg, #fff); border: 1px solid var(--border-color, #ddd); border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,0.18); display: flex; flex-direction: column; overflow: hidden; min-width: 150px; z-index: 10001; }

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
                           148px는 설명이 두 줄인 카드(원가/순익 분석·위생점검)의 자연 높이.
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
                        <div className="card-title">위생점검</div>
                        <div className="card-desc">점검 기록 확인 및 체크리스트 관리</div>
                    </button>
                </div>
            </div>
        </div>
    );
}

export default AdminDashboard;
