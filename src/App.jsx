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
import { startRegistration } from "@simplewebauthn/browser";

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


    // ---------------------------------------------------------
    // 2. [소켓 및 실시간 상태] 로직 (독립된 상자)
    // ---------------------------------------------------------
    useEffect(() => {
        if (!auth.isLoggedIn) return;

        let disconnectTimer;

        // 출석 체크 함수
        const registerMyUser = () => {
            if (auth.user && auth.user.username) {
                console.log(`🙋‍♂️ 서버에 출석 체크: ${auth.user.username}`);
                socket.emit('register_user', {
                    username: auth.user.username,
                    role: auth.user.role
                });
            }
        };

        // 소켓 이벤트 리스너 등록
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

        // 청소하기 (모든 리스너 해제)
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
    };

    // --- 화면 렌더링 로직 ---

    // 1. 로그인 전이라면?
    if (!auth.isLoggedIn) {
        if (auth.view === 'register') {
            return <Register onSwitchToLogin={() => setAuth({ ...auth, view: 'login' })} />;
        }
        return <Login onLoginSuccess={handleLoginSuccess} onSwitchToRegister={() => setAuth({ ...auth, view: 'register' })} />;
    }

    // 2. 로그인 후: 관리자라면?
    if (auth.user.role === 'admin') {
        return <AdminDashboard onLogout={handleLogout} />;
    }

    // 3. 로그인 후: 직원이면? (기존 로직 실행)
    const renderContent = () => {
        if (myRole === 'cashier') {
            return <OnePersonMode onlyOrder={false} isCashier={true} onBack={() => { socket.emit('release_cashier'); setMyRole(null); }} />;
        }
        if (myRole === 'kitchen') {
            return <Kitchen onBack={() => setMyRole(null)} />;
        }
        if (userCount <= 1) {
            // 혼자 하기 모드에서도 로그아웃 버튼 하나 추가해주면 좋음 (일단 생략)
            return <OnePersonMode />;
        }
        return <RoleSelection onSelectRole={setMyRole} isCashierTaken={isCashierTaken} />;
    };

// ... handleLogout 함수 근처 ...

    // 👈 [추가 2] 기기 등록(패스키) 핸들러
    const handleRegisterPasskey = async () => {
        // 로그인 정보에 id가 있어야 함 (Login.jsx에서 저장했는지 확인 필요)
        if (!auth.user || !auth.user.id) {
            alert("사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.");
            return;
        }

        const userId = auth.user.id;

        try {
            // 1. 등록 옵션 요청
            const resp = await axios.get(`/api/passkey/register-options?userId=${userId}`);

            // 2. 브라우저 인증(지문/FaceID) 수행
            let attResp;
            try {
                attResp = await startRegistration(resp.data);
            } catch (error) {
                if (error.name === 'NotAllowedError') return; // 사용자가 취소함
                throw error;
            }

            // 3. 결과 서버로 전송
            const verificationResp = await axios.post('/api/passkey/register-verify', {
                userId,
                body: attResp,
            });

            if (verificationResp.data.success) {
                alert('✅ 기기 등록 완료! 다음부터 지문/FaceID로 로그인하세요.');
            }
        } catch (error) {
            console.error(error);
            alert('기기 등록 실패: ' + (error.response?.data?.error || error.message));
        }
    };

    // --- 화면 렌더링 로직 ---

    return (
        <div>
            {/* 상단 헤더 영역 (이름 + 로그아웃 버튼 있는 곳) */}
            {auth.isLoggedIn && (
                <div style={{
                    position: 'absolute',
                    top: '10px',
                    right: '20px',
                    zIndex: 9999,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '15px' // 요소 간 간격
                }}>

                    {/* ✅ 3. 시재 점검 버튼 (관리자가 아닐 때만, 혹은 모두에게) */}
                    {(myRole === 'cashier' || userCount <= 1) && (
                        <button
                            onClick={() => setShowSettlement(true)}
                            style={{
                                padding: '8px 12px',
                                backgroundColor: '#28a745', // 초록색 (돈 관련)
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

                    <button
                        onClick={handleRegisterPasskey}
                        style={{
                            padding: '8px 12px',
                            backgroundColor: '#6f42c1', // 보라색으로 구분
                            color: 'white',
                            border: 'none',
                            borderRadius: '20px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
                        }}
                    >
                        🔑 기기 등록
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
                            backgroundColor: '#6c757d',
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

            {/* ✅ 4. 모달 렌더링 (화면 맨 위에 띄움) */}
            {showSettlement && (
                <CashSettlement onClose={() => setShowSettlement(false)} />
            )}

            {/* 메인 컨텐츠 */}
            {renderContent()}
        </div>
    );
}

export default App;