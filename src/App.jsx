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

    const SESSION_TIMEOUT = 60 * 60 * 1000; // 1시간

    // ---------------------------------------------------------
    // [2] 인증 및 세션 관리 (Auth & Session)
    // ---------------------------------------------------------
    const handleLogout = useCallback(() => {
        socket.emit('logout');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('lastActivity');

        setAuth({isLoggedIn: false, user: null, view: 'login'});
        setMyRole(null);
        setShowProfile(false);
        setIsProfileVerified(false);
    }, []);

    const handleAutoLogout = useCallback(() => {
        alert("보안을 위해 1시간 동안 활동이 없어 자동 로그아웃되었습니다.");
        handleLogout();
    }, [handleLogout]);

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

        if (socket.connected) registerMyUser();
        socket.on('connect', registerMyUser);

        socket.on('cashier_status', (isTaken) => setIsCashierTaken(isTaken));
        socket.on('kitchen_status', (isActive) => setIsKitchenActive(isActive));
        socket.emit('request_state'); // 현재 상태 요청

        return () => {
            socket.off('connect', registerMyUser);
            socket.off('user_count');
            socket.off('cashier_status');
            socket.off('kitchen_status');
        };
    }, [auth.isLoggedIn, auth.user]);

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
        if (showProfile) {
            return isProfileVerified
                ? <EditProfile onBack={() => {
                    setShowProfile(false);
                    setIsProfileVerified(false);
                }}/>
                : <ProfileAuth currentUser={auth.user} onSuccess={() => setIsProfileVerified(true)}
                               onCancel={() => setShowProfile(false)}/>;
        }
        return <AdminDashboard onLogout={handleLogout} onEditProfile={() => setShowProfile(true)}/>;
    }

    // 직원 화면 (프로필 수정 모달)
    if (showProfile) {
        return isProfileVerified
            ? <EditProfile onBack={() => {
                setShowProfile(false);
                setIsProfileVerified(false);
            }}/>
            : <ProfileAuth currentUser={auth.user} onSuccess={() => setIsProfileVerified(true)}
                           onCancel={() => setShowProfile(false)}/>;
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
                .btn-settle { background-color: #28a745; }
                .btn-profile { background-color: #6c757d; }
                .btn-back-role { background-color: #495057; margin-right: auto; }
                
                .global-user-name { font-weight: bold; color: var(--text-primary, #333); font-size: 1rem; text-shadow: 0px 0px 8px var(--bg-color, rgba(255,255,255,0.8)); }
                
                .btn-global-logout { padding: 8px 12px; background-color: #dc3545; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 0.9rem; transition: transform 0.1s; }
                .btn-global-logout:active { transform: scale(0.95); }

                .desktop-user-menu { display: flex; align-items: center; gap: 12px; }
                .mobile-user-menu { display: none; position: relative; }
                
                .btn-mobile-dropdown { padding: 6px 12px; border-radius: 20px; border: 1px solid var(--border-color, #ccc); background-color: var(--card-bg, #fff); color: var(--text-primary, #333); font-weight: bold; font-size: 0.85rem; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.1); display: flex; align-items: center; gap: 5px; }
                
                .mobile-dropdown-content { position: absolute; top: 110%; right: 0; background-color: var(--card-bg, #fff); border: 1px solid var(--border-color, #ddd); border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); display: flex; flex-direction: column; overflow: hidden; min-width: 110px; z-index: 10000; }
                
                .dropdown-item { padding: 12px 15px; background: none; border: none; border-bottom: 1px solid var(--border-color, #eee); text-align: left; font-size: 0.9rem; font-weight: bold; color: var(--text-primary, #333); cursor: pointer; transition: background-color 0.2s; }
                .dropdown-item:last-child { border-bottom: none; }
                .dropdown-item.logout { color: #dc3545; }
                .dropdown-item:active { background-color: var(--border-color, #f0f0f0); }

                @media (max-width: 768px) {
                    .global-top-header { top: 10px; right: 10px; gap: 8px; left: 10px; }
                    .btn-global-action { padding: 6px 10px; font-size: 0.85rem; }
                    
                    .desktop-user-menu { display: none; }
                    .mobile-user-menu { display: block; }
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

                    <ThemeToggle/>

                    {/* 🖥️ 데스크탑 뷰 (모바일에서는 숨김) */}
                    <div className="desktop-user-menu">
                        <button onClick={() => setShowProfile(true)} className="btn-global-action btn-profile">⚙️ 내 정보
                        </button>
                        <span className="global-user-name">{auth.user.name}님</span>
                        <button onClick={handleLogout} className="btn-global-logout">로그아웃</button>
                    </div>

                    {/* 📱 모바일 뷰 (데스크탑에서는 숨김) */}
                    <div className="mobile-user-menu">
                        <button
                            className="btn-mobile-dropdown"
                            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        >
                            👤 {auth.user.name}님 ▼
                        </button>

                        {/* 드롭다운 열렸을 때 나오는 메뉴들 */}
                        {isDropdownOpen && (
                            <div className="mobile-dropdown-content">
                                <button onClick={() => {
                                    setShowProfile(true);
                                    setIsDropdownOpen(false);
                                }} className="dropdown-item">⚙️ 내 정보
                                </button>
                                <button onClick={() => {
                                    handleLogout();
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
        </div>
    );
}

export default App;