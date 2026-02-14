// TODO: 다크 / 라이트 / 시스템 테마 제작 및 적용

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { socket } from './socket';
import OnePersonMode from './OnePersonMode';
import Kitchen from './Kitchen';
import RoleSelection from './RoleSelection';
import Login from './Login';
import Register from './Register';
import AdminDashboard from './AdminDashboard';
import CashSettlement from "./CashSettlement.jsx";
import ProfileAuth from './ProfileAuth.jsx';
import EditProfile from './EditProfile.jsx';

function App() {
    const [auth, setAuth] = useState({
        isLoggedIn: false,
        user: null,
        view: 'login'
    });

    const SESSION_TIMEOUT = 1 * 60 * 60 * 1000;

    const handleAutoLogout = useCallback(() => {
        alert("보안을 위해 1시간 동안 활동이 없어 자동 로그아웃되었습니다.");
        handleLogout();
    }, []);

    const [userCount, setUserCount] = useState(0);
    const [myRole, setMyRole] = useState(null);
    const [isCashierTaken, setIsCashierTaken] = useState(false);
    const [showSettlement, setShowSettlement] = useState(false);
    const [showProfile, setShowProfile] = useState(false);
    const [isProfileVerified, setIsProfileVerified] = useState(false);

    useEffect(() => {
        const token = localStorage.getItem('token');
        const storedUser = localStorage.getItem('user');
        const lastActivity = localStorage.getItem('lastActivity');

        if (token && storedUser) {
            const now = Date.now();

            if (lastActivity && (now - parseInt(lastActivity, 10) > SESSION_TIMEOUT)) {
                console.log("⏰ 브라우저 종료 후 1시간 초과. 자동 로그아웃 처리.");
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
    }, []);

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
        }, 60000);

        return () => {
            window.removeEventListener('mousemove', updateActivity);
            window.removeEventListener('keydown', updateActivity);
            window.removeEventListener('click', updateActivity);
            clearInterval(interval);
        };
    }, [auth.isLoggedIn, handleAutoLogout]);

    useEffect(() => {
        if (!auth.isLoggedIn) return;

        let disconnectTimer;

        const registerMyUser = () => {
            if (auth.user && auth.user.username) {
                console.log(`🙋‍♂️ 서버에 출석 체크: ${auth.user.username}`);
                socket.emit('register_user', {
                    username: auth.user.username,
                    role: auth.user.role
                });
            }
        };

        if (socket.connected) registerMyUser();
        socket.on('connect', registerMyUser);

        socket.on('user_count', (count) => {
            setUserCount(count);
            if (count <= 1) {
                if (disconnectTimer) clearTimeout(disconnectTimer);
                disconnectTimer = setTimeout(() => { setMyRole(null); }, 3000);
            } else {
                if (disconnectTimer) clearTimeout(disconnectTimer);
            }
        });

        socket.on('cashier_status', (isTaken) => setIsCashierTaken(isTaken));
        socket.emit('request_state');

        return () => {
            socket.off('connect', registerMyUser);
            socket.off('user_count');
            socket.off('cashier_status');
            if (disconnectTimer) clearTimeout(disconnectTimer);
        };
    }, [auth.isLoggedIn, auth.user]);

    const handleLoginSuccess = (userData) => {
        setAuth({ isLoggedIn: true, user: userData, view: 'app' });
    };

    const handleLogout = () => {
        socket.emit('logout');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('lastActivity');
        setAuth({ isLoggedIn: false, user: null, view: 'login' });
        setMyRole(null);
        setShowProfile(false);
        setIsProfileVerified(false);
    };

    if (!auth.isLoggedIn) {
        if (auth.view === 'register') {
            return <Register onSwitchToLogin={() => setAuth({ ...auth, view: 'login' })} />;
        }
        return <Login onLoginSuccess={handleLoginSuccess} onSwitchToRegister={() => setAuth({ ...auth, view: 'register' })} />;
    }

    if (showProfile) {
        if (isProfileVerified) {
            return <EditProfile onBack={() => {
                setShowProfile(false);
                setIsProfileVerified(false);
            }} />;
        }
        else {
            return (
                <ProfileAuth
                    currentUser={auth.user}
                    onSuccess={() => setIsProfileVerified(true)}
                    onCancel={() => setShowProfile(false)}
                />
            );
        }
    }

    if (auth.user.role === 'admin') {
        return <AdminDashboard
            onLogout={handleLogout}
            onEditProfile={() => setShowProfile(true)}
        />;
    }

    const renderContent = () => {
        if (myRole === 'cashier') {
            return <OnePersonMode onlyOrder={false} isCashier={true} onBack={() => { socket.emit('release_cashier'); setMyRole(null); }} />;
        }
        if (myRole === 'kitchen') {
            return <Kitchen onBack={() => setMyRole(null)} />;
        }
        if (userCount <= 1) {
            return <OnePersonMode />;
        }
        return <RoleSelection onSelectRole={setMyRole} isCashierTaken={isCashierTaken} />;
    };

    return (
        <div>
            {/* 앱 전체 공통 스타일 정의 (App.jsx에서 선언하여 전역 적용) */}
            <style>
                {`
                /* 기본 배경색 (다크모드 대응을 위한 설정) */
                body {
                    margin: 0;
                    background-color: var(--bg-color, #f4f6f8);
                    color: var(--text-primary, #333);
                    transition: background-color 0.3s ease, color 0.3s ease;
                }

                /* 🌟 글로벌 상단 플로팅 헤더 최적화 */
                .global-top-header {
                    position: absolute;
                    top: 15px;
                    right: 20px;
                    z-index: 9999;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    flex-wrap: wrap;
                    justify-content: flex-end;
                }

                .btn-global-action {
                    padding: 8px 12px;
                    color: white;
                    border: none;
                    border-radius: 20px;
                    font-weight: bold;
                    cursor: pointer;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.15);
                    transition: transform 0.1s;
                    font-size: 0.95rem;
                }
                .btn-global-action:active { transform: scale(0.95); }
                .btn-settle { background-color: #28a745; }
                .btn-profile { background-color: #6c757d; }
                
                .global-user-name {
                    font-weight: bold;
                    color: var(--text-primary, #333);
                    font-size: 1rem;
                    /* 배경색과 겹칠 때 가독성을 높이기 위한 미세한 그림자 */
                    text-shadow: 0px 0px 8px var(--bg-color, rgba(255,255,255,0.8));
                }

                .btn-global-logout {
                    padding: 8px 12px;
                    background-color: #dc3545;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    font-weight: bold;
                    font-size: 0.9rem;
                    transition: transform 0.1s;
                }
                .btn-global-logout:active { transform: scale(0.95); }

                /* 📱 모바일 화면 최적화 (768px 이하) */
                @media (max-width: 768px) {
                    .global-top-header {
                        top: 10px;
                        right: 10px;
                        gap: 8px;
                        left: 10px; /* 공간이 부족하면 왼쪽으로 확장 허용 */
                    }
                    .btn-global-action {
                        padding: 6px 10px;
                        font-size: 0.85rem;
                    }
                    .global-user-name {
                        font-size: 0.9rem;
                    }
                    .btn-global-logout {
                        padding: 6px 10px;
                        font-size: 0.85rem;
                    }
                }
                `}
            </style>

            {/* 상단 헤더 영역 */}
            {auth.isLoggedIn && (
                <div className="global-top-header">
                    {(myRole === 'cashier' || userCount <= 1) && (
                        <button onClick={() => setShowSettlement(true)} className="btn-global-action btn-settle">
                            💰 시재 점검
                        </button>
                    )}

                    <button onClick={() => setShowProfile(true)} className="btn-global-action btn-profile">
                        ⚙️ 내 정보
                    </button>

                    <span className="global-user-name">
                        {auth.user.name}님
                    </span>

                    <button onClick={handleLogout} className="btn-global-logout">
                        로그아웃
                    </button>
                </div>
            )}

            {/* 모달 렌더링 */}
            {showSettlement && (
                <CashSettlement onClose={() => setShowSettlement(false)} />
            )}

            {/* 메인 컨텐츠 */}
            {renderContent()}
        </div>
    );
}

export default App;