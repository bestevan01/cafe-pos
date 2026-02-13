import { useState, useEffect, useCallback } from 'react';
import axios from 'axios'; // 삭제해도 되지만, 로그인/로그아웃 등 다른 곳에서 쓸 수 있으니 유지
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
    // 1. 로그인 상태 관리
    const [auth, setAuth] = useState({
        isLoggedIn: false,
        user: null, // { name: '홍길동', role: 'staff' }
        view: 'login' // 'login', 'register', 'app'
    });

    const SESSION_TIMEOUT = 1 * 60 * 60 * 1000;

    const handleAutoLogout = useCallback(() => {
        alert("보안을 위해 1시간 동안 활동이 없어 자동 로그아웃되었습니다.");
        handleLogout();
    }, []);

    // 2. 기존 앱 상태 관리
    const [userCount, setUserCount] = useState(0);
    const [myRole, setMyRole] = useState(null);
    const [isCashierTaken, setIsCashierTaken] = useState(false);
    const [showSettlement, setShowSettlement] = useState(false);

    // ✅ [추가] 내 정보 수정 화면을 보여줄지 여부
    const [showProfile, setShowProfile] = useState(false);
    const [isProfileVerified, setIsProfileVerified] = useState(false);

    // 🔄 새로고침 해도 로그인 유지하기
    useEffect(() => {
        const token = localStorage.getItem('token');
        const storedUser = localStorage.getItem('user');
        if (token && storedUser) {
            setAuth({
                isLoggedIn: true,
                user: JSON.parse(storedUser),
                view: 'app'
            });
        }
    }, []);

    // 소켓 로직 (기존과 동일)
    useEffect(() => {
        if (!auth.isLoggedIn) return;

        let lastActivity = Date.now();
        const updateActivity = () => { lastActivity = Date.now(); };

        window.addEventListener('mousemove', updateActivity);
        window.addEventListener('keydown', updateActivity);
        window.addEventListener('click', updateActivity);

        const interval = setInterval(() => {
            const now = Date.now();
            if (now - lastActivity > SESSION_TIMEOUT) {
                handleAutoLogout();
            }
        }, 60000); // 1분마다 체크

        return () => {
            window.removeEventListener('mousemove', updateActivity);
            window.removeEventListener('keydown', updateActivity);
            window.removeEventListener('click', updateActivity);
            clearInterval(interval);
        };
    }, [auth.isLoggedIn, handleAutoLogout]);

    // 소켓 및 실시간 상태 로직
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

    // --- 로그인/로그아웃 핸들러 ---
    const handleLoginSuccess = (userData) => {
        setAuth({ isLoggedIn: true, user: userData, view: 'app' });
    };

    const handleLogout = () => {
        socket.emit('logout');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setAuth({ isLoggedIn: false, user: null, view: 'login' });
        setMyRole(null);
        setShowProfile(false); // 로그아웃 시 프로필 화면 닫기
        setIsProfileVerified(false);
    };

    // ❌ 삭제됨: handleRegisterPasskey 함수 (EditProfile로 이동했으므로 필요 없음)

    // --- 화면 렌더링 로직 ---

    // 1. 로그인 전이라면?
    if (!auth.isLoggedIn) {
        if (auth.view === 'register') {
            return <Register onSwitchToLogin={() => setAuth({ ...auth, view: 'login' })} />;
        }
        return <Login onLoginSuccess={handleLoginSuccess} onSwitchToRegister={() => setAuth({ ...auth, view: 'register' })} />;
    }

    // ✅ 2. [수정] 내 정보 수정 화면이 켜져있다면? (관리자든 직원이든 볼 수 있게 최상위에 배치)
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

    // 3. 로그인 후: 관리자라면?
    if (auth.user.role === 'admin') {
        return <AdminDashboard onLogout={handleLogout} />;
    }

    // 4. 로그인 후: 직원이면? (기존 로직 실행)
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
            {/* 상단 헤더 영역 */}
            {auth.isLoggedIn && (
                <div style={{
                    position: 'absolute',
                    top: '10px',
                    right: '20px',
                    zIndex: 9999,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '15px'
                }}>
                    {/* 시재 점검 버튼 */}
                    {(myRole === 'cashier' || userCount <= 1) && (
                        <button
                            onClick={() => setShowSettlement(true)}
                            style={{
                                padding: '8px 12px',
                                backgroundColor: '#28a745',
                                color: 'white',
                                border: 'none',
                                borderRadius: '20px',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
                            }}
                        >
                            💰 시재 점검
                        </button>
                    )}

                    {/* ✅ [수정] 기기 등록 버튼 -> 내 정보 버튼으로 변경 */}
                    <button
                        onClick={() => setShowProfile(true)}
                        style={{
                            padding: '8px 12px',
                            backgroundColor: '#495057', // 회색 계열로 변경 (설정 느낌)
                            color: 'white',
                            border: 'none',
                            borderRadius: '20px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
                        }}
                    >
                        ⚙️ 내 정보
                    </button>

                    {/* 이름 표시 */}
                    <span style={{ fontWeight: 'bold', color: '#333' }}>
                        {auth.user.name}님
                    </span>

                    {/* 로그아웃 버튼 */}
                    <button
                        onClick={handleLogout}
                        style={{
                            padding: '8px 12px',
                            backgroundColor: '#dc3545', // 빨간색 계열
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer'
                        }}
                    >
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