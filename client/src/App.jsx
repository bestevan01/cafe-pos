import {useState, useEffect, useCallback} from 'react';
import {socket} from './utils/socket';

// Pages & Components
import RoleSelection from './pages/pos/RoleSelection';
import OnePersonMode from './pages/pos/OnePersonMode';
import Kitchen from './pages/pos/Kitchen';
import CashSettlement from "./pages/pos/CashSettlement.jsx";
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import ProfileAuth from './pages/auth/ProfileAuth.jsx';
import EditProfile from './pages/auth/EditProfile.jsx';
import AdminDashboard from './pages/admin/AdminDashboard';
import ThemeToggle from './components/ThemeToggle';
import {useTheme} from './hooks/useTheme';
import {useNotification} from './hooks/useNotification';

function App() {
    // ---------------------------------------------------------
    // [1] 상태 관리 (State)
    // ---------------------------------------------------------
    const [auth, setAuth] = useState({
        isLoggedIn: false,
        user: null,
        view: 'login' // 'login', 'register', 'app'
    });

    const [myRole, setMyRole] = useState(null); // 'cashier', 'kitchen', null
    const [isCashierTaken, setIsCashierTaken] = useState(false);
    const [isKitchenActive, setIsKitchenActive] = useState(false);

    // 모달 상태
    const [showSettlement, setShowSettlement] = useState(false);
    const [showProfile, setShowProfile] = useState(false);
    const [isProfileVerified, setIsProfileVerified] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const {theme, setTheme} = useTheme(); // 모바일 드롭다운의 테마 선택용
    const [isThemeSubOpen, setIsThemeSubOpen] = useState(false); // 테마 하위 메뉴(왼쪽 플라이아웃)

    // 역할(화면) 전환 시 사용자 드롭다운/테마 서브메뉴 닫기
    useEffect(() => {
        setIsDropdownOpen(false);
        setIsThemeSubOpen(false);
    }, [myRole]);

    const SESSION_TIMEOUT = 60 * 60 * 1000; // 1시간
    const {notify} = useNotification();

    // ---------------------------------------------------------
    // [2] 인증 및 세션 관리 (Auth & Session)
    // ---------------------------------------------------------
    const handleLogout = useCallback(() => {
        socket.emit('logout');
        socket.disconnect();
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('lastActivity');

        setAuth({isLoggedIn: false, user: null, view: 'login'});
        setMyRole(null);
        setShowProfile(false);
        setIsProfileVerified(false);
    }, []);

    // 사용자가 직접 로그아웃 버튼을 눌렀을 때 (자동/세션만료 경로와 구분해 성공 안내)
    const handleManualLogout = useCallback(() => {
        notify("로그아웃되었습니다.", {icon: '👋'});
        handleLogout();
    }, [handleLogout, notify]);

    const handleAutoLogout = useCallback(() => {
        notify("보안을 위해 1시간 동안 활동이 없어 자동 로그아웃되었습니다.", {icon: '🔒'});
        handleLogout();
    }, [handleLogout, notify]);

    // 초기 실행: 로컬 스토리지에서 세션 복구
    useEffect(() => {
        const token = localStorage.getItem('token');
        const storedUser = localStorage.getItem('user');
        const lastActivity = localStorage.getItem('lastActivity');

        if (token && storedUser) {
            const now = Date.now();
            if (lastActivity && (now - parseInt(lastActivity, 10) > SESSION_TIMEOUT)) {
                console.log("⏰ 세션 만료. 자동 로그아웃.");
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                localStorage.removeItem('lastActivity');
                return;
            }

            setAuth({
                isLoggedIn: true,
                user: JSON.parse(storedUser),
                view: 'app'
            });
            localStorage.setItem('lastActivity', now.toString());
        }
    }, [SESSION_TIMEOUT]);

    // 활동 감지 (세션 연장)
    useEffect(() => {
        if (!auth.isLoggedIn) return;

        const updateActivity = () => {
            localStorage.setItem('lastActivity', Date.now().toString());
        };

        window.addEventListener('mousemove', updateActivity);
        window.addEventListener('keydown', updateActivity);
        window.addEventListener('click', updateActivity);

        const interval = setInterval(() => {
            const now = Date.now();
            const lastActivity = parseInt(localStorage.getItem('lastActivity') || now.toString(), 10);
            if (now - lastActivity > SESSION_TIMEOUT) {
                handleAutoLogout();
            }
        }, 60000); // 1분마다 검사

        return () => {
            window.removeEventListener('mousemove', updateActivity);
            window.removeEventListener('keydown', updateActivity);
            window.removeEventListener('click', updateActivity);
            clearInterval(interval);
        };
    }, [auth.isLoggedIn, SESSION_TIMEOUT, handleAutoLogout]);

    // REST 401(만료·무효 토큰) 전역 처리: axios 인터셉터가 보낸 'app:session-expired'를 받아 재로그인 유도
    useEffect(() => {
        const onExpired = () => {
            notify('세션이 만료되었습니다. 다시 로그인해주세요.', {icon: '🔒'});
            handleLogout();
        };
        window.addEventListener('app:session-expired', onExpired);
        return () => window.removeEventListener('app:session-expired', onExpired);
    }, [handleLogout, notify]);

    // ---------------------------------------------------------
    // [3] 소켓 통신 (Socket.io)
    // ---------------------------------------------------------
    useEffect(() => {
        if (!auth.isLoggedIn || !auth.user) return;

        const registerMyUser = () => {
            console.log(`🙋‍♂️ 소켓 연결: ${auth.user.username}`);
            socket.emit('register_user', /** @type {any} */{
                username: auth.user.username,
                role: auth.user.role
            });
        };

        // 인증 실패(만료/위조 토큰)로 연결이 거부된 경우에만 재로그인 유도.
        // 일시적 네트워크 오류는 type 표시가 없으므로 무시 → socket.io가 자동 재시도.
        const handleAuthError = (err) => {
            if (err?.data?.type === 'auth') {
                socket.disconnect(); // 무한 재시도 중단
                notify('세션이 만료되었습니다. 다시 로그인해주세요.', {icon: '🔒'});
                handleLogout();
            }
        };

        if (socket.connected) registerMyUser();
        else socket.connect(); // 로그인 상태면 소켓 연결 시작 (핸드셰이크에 토큰 전송)
        socket.on('connect', registerMyUser);
        socket.on('connect_error', handleAuthError);

        socket.on('cashier_status', (isTaken) => setIsCashierTaken(isTaken));
        socket.on('kitchen_status', (isActive) => setIsKitchenActive(isActive));
        socket.emit('request_state'); // 현재 상태 요청

        return () => {
            socket.off('connect', registerMyUser);
            socket.off('connect_error', handleAuthError);
            socket.off('user_count');
            socket.off('cashier_status');
            socket.off('kitchen_status');
        };
    }, [auth.isLoggedIn, auth.user, handleLogout, notify]);

    // ---------------------------------------------------------
    // [4] 렌더링 로직 (Render Logic)
    // ---------------------------------------------------------
    const handleLoginSuccess = (userData) => {
        setAuth({isLoggedIn: true, user: userData, view: 'app'});
    };

    // 로그인 전 화면 처리
    if (!auth.isLoggedIn) {
        if (auth.view === 'register') {
            return <Register onSwitchToLogin={() => setAuth({...auth, view: 'login'})}/>;
        }
        return <Login onLoginSuccess={handleLoginSuccess}
                      onSwitchToRegister={() => setAuth({...auth, view: 'register'})}/>;
    }

    // 관리자 대시보드
    if (auth.user.role === 'admin') {
        // 본인 확인 통과 후엔 EditProfile 전체 페이지로 전환
        if (showProfile && isProfileVerified) {
            return <EditProfile onBack={() => {
                setShowProfile(false);
                setIsProfileVerified(false);
            }}/>;
        }
        // 대시보드는 그대로 두고, 본인 확인(ProfileAuth)은 그 위에 모달로 띄운다
        return (
            <>
                <AdminDashboard onLogout={handleManualLogout} onEditProfile={() => setShowProfile(true)}/>
                {showProfile && (
                    <ProfileAuth currentUser={auth.user}
                                 onSuccess={() => setIsProfileVerified(true)}
                                 onCancel={() => setShowProfile(false)}/>
                )}
            </>
        );
    }

    // 직원: 본인 확인 통과 후엔 EditProfile 전체 페이지로 전환 (그 전 본인확인 모달은 아래 메인 레이아웃 위에 오버레이로 띄움)
    if (showProfile && isProfileVerified) {
        return <EditProfile onBack={() => {
            setShowProfile(false);
            setIsProfileVerified(false);
        }}/>;
    }

    // 직원 화면 컨텐츠 분기
    const renderContent = () => {
        if (myRole === 'cashier') {
            return <OnePersonMode onlyOrder={false} isCashier={isKitchenActive} onBack={() => {
                socket.emit('release_cashier');
                setMyRole(null);
            }}/>;
        }
        if (myRole === 'kitchen') {
            return <Kitchen onBack={() => {
                socket.emit('leave_kitchen');
                setMyRole(null);
            }}/>;
        }

        return <RoleSelection
            onSelectRole={(role) => {
                if (role === 'kitchen') socket.emit('join_kitchen');
                setMyRole(role);
            }}
            isCashierTaken={isCashierTaken}
        />;
    };

    return (
        <div>
            {/* 전역 스타일 */}
            <style>
                {`
                body { margin: 0; background-color: var(--bg-color, #f4f6f8); color: var(--text-primary, #333); transition: background-color 0.3s ease, color 0.3s ease; }
                
                /* 상단 플로팅 헤더 */
                .global-top-header { position: absolute; top: 15px; left: 20px; right: 20px; z-index: 9999; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; }
                
                .btn-global-action { padding: 8px 12px; color: white; border: none; border-radius: 20px; font-weight: bold; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.15); transition: transform 0.1s; font-size: 0.95rem; }
                .btn-global-action:active { transform: scale(0.95); }
                .btn-settle { background-color: var(--success); }
                .btn-profile { background-color: var(--neutral); }
                .btn-back-role { background-color: var(--neutral); margin-right: auto; }
                
                .global-user-name { font-weight: bold; color: var(--text-primary, #333); font-size: 1rem; text-shadow: 0px 0px 8px var(--bg-color, rgba(255,255,255,0.8)); }
                
                .btn-global-logout { padding: 8px 12px; background-color: var(--danger); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 0.9rem; transition: transform 0.1s; }
                .btn-global-logout:active { transform: scale(0.95); }

                .desktop-user-menu { display: flex; align-items: center; gap: 12px; }
                .mobile-user-menu { display: none; position: relative; }
                
                .btn-mobile-dropdown { padding: 6px 12px; border-radius: 20px; border: 1px solid var(--border-color, #ccc); background-color: var(--card-bg, #fff); color: var(--text-primary, #333); font-weight: bold; font-size: 0.85rem; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.1); display: flex; align-items: center; gap: 5px; }
                
                .mobile-dropdown-content { position: absolute; top: 110%; right: 0; background-color: var(--card-bg, #fff); border: 1px solid var(--border-color, #ddd); border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); display: flex; flex-direction: column; overflow: visible; min-width: 120px; z-index: 10000; }
                
                .dropdown-item { padding: 12px 15px; background: none; border: none; border-bottom: 1px solid var(--border-color, #eee); text-align: left; font-size: 0.9rem; font-weight: bold; color: var(--text-primary, #333); cursor: pointer; transition: background-color 0.2s; white-space: nowrap; }
                .dropdown-item:last-child { border-bottom: none; }
                .dropdown-item.logout { color: var(--danger); }
                .dropdown-item:active { background-color: var(--border-color, #f0f0f0); }
                .global-theme-desktop { display: inline-flex; align-items: center; }
                .dropdown-item.active { color: var(--accent); font-weight: 800; }
                .dropdown-theme-wrap { position: relative; }
                .dropdown-theme-toggle { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
                .dropdown-sub-arrow { color: var(--text-secondary, #999); font-size: 1.1rem; line-height: 1; }
                .dropdown-submenu { position: absolute; right: calc(100% + 6px); top: 0; background-color: var(--card-bg, #fff); border: 1px solid var(--border-color, #ddd); border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,0.18); display: flex; flex-direction: column; overflow: hidden; min-width: 150px; z-index: 10001; }

                @media (max-width: 768px) {
                    .global-top-header { top: 10px; right: 10px; gap: 8px; left: 10px; }
                    .btn-global-action { padding: 6px 10px; font-size: 0.85rem; }

                    .desktop-user-menu { display: none; }
                    .mobile-user-menu { display: block; }
                    .global-theme-desktop { display: none; } /* 모바일: 테마 버튼은 사용자 드롭다운 안으로 이동 */
                }
                `}
            </style>

            {/* 상단 헤더 영역 */}
            {auth.isLoggedIn && (
                <div className="global-top-header">
                    {myRole && (
                        <button
                            onClick={() => {
                                if (myRole === 'cashier') socket.emit('release_cashier');
                                if (myRole === 'kitchen') socket.emit('leave_kitchen');
                                setMyRole(null);
                            }}
                            className="btn-global-action btn-back-role"
                        >
                            ⬅ 역할 변경
                        </button>
                    )}

                    {myRole === 'cashier' && (
                        <button onClick={() => setShowSettlement(true)} className="btn-global-action btn-settle">💰 시재
                            점검</button>
                    )}

                    <span className="global-theme-desktop"><ThemeToggle/></span>

                    {/* 🖥️ 데스크탑 뷰 (모바일에서는 숨김) */}
                    <div className="desktop-user-menu">
                        <button onClick={() => setShowProfile(true)} className="btn-global-action btn-profile">⚙️ 내 정보
                        </button>
                        <span className="global-user-name">{auth.user.name}님</span>
                        <button onClick={handleManualLogout} className="btn-global-logout">로그아웃</button>
                    </div>

                    {/* 📱 모바일 뷰 (데스크탑에서는 숨김) */}
                    <div className="mobile-user-menu">
                        <button
                            className="btn-mobile-dropdown"
                            onClick={() => {
                                setIsDropdownOpen(!isDropdownOpen);
                                setIsThemeSubOpen(false);
                            }}
                        >
                            👤 {auth.user.name}님 ▼
                        </button>

                        {/* 드롭다운 열렸을 때 나오는 메뉴들 */}
                        {isDropdownOpen && (
                            <div className="mobile-dropdown-content">
                                <div className="dropdown-theme-wrap">
                                    <button className="dropdown-item dropdown-theme-toggle"
                                            onClick={() => setIsThemeSubOpen(!isThemeSubOpen)}>
                                        <span>🎨 테마 변경</span>
                                        <span className="dropdown-sub-arrow">‹</span>
                                    </button>
                                    {isThemeSubOpen && (
                                        <div className="dropdown-submenu">
                                            <button className={`dropdown-item ${theme === 'light' ? 'active' : ''}`}
                                                    onClick={() => setTheme('light')}>☀️ 라이트 모드
                                            </button>
                                            <button className={`dropdown-item ${theme === 'dark' ? 'active' : ''}`}
                                                    onClick={() => setTheme('dark')}>🌙 다크 모드
                                            </button>
                                            <button className={`dropdown-item ${theme === 'system' ? 'active' : ''}`}
                                                    onClick={() => setTheme('system')}>💻 시스템 설정
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <button onClick={() => {
                                    setShowProfile(true);
                                    setIsDropdownOpen(false);
                                }} className="dropdown-item">⚙️ 내 정보
                                </button>
                                <button onClick={() => {
                                    handleManualLogout();
                                    setIsDropdownOpen(false);
                                }} className="dropdown-item logout">🚪 로그아웃
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 시재 점검 모달 */}
            {showSettlement && <CashSettlement onClose={() => setShowSettlement(false)}/>}

            {/* 메인 화면 렌더링 */}
            {renderContent()}

            {/* 본인 확인 모달: 현재 페이지를 그대로 두고 그 위에 오버레이로 띄움 */}
            {showProfile && !isProfileVerified && (
                <ProfileAuth currentUser={auth.user}
                             onSuccess={() => setIsProfileVerified(true)}
                             onCancel={() => setShowProfile(false)}/>
            )}
        </div>
    );
}

export default App;