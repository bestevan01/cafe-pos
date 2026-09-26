import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { socket, onResync } from './utils/socket';

// Pages & Components
import RoleSelection from './pages/pos/RoleSelection';
import Cashier from './pages/pos/Cashier';
import Kitchen from './pages/pos/Kitchen';
import CashSettlement from './pages/pos/CashSettlement.jsx';
import HygieneCheck from './pages/pos/HygieneCheck.jsx';
import InventoryCount from './pages/pos/InventoryCount.jsx';
import {
    show as showBrowserAlert,
    runAlertAction,
    registerAlertAction,
    listenForAlertActions,
} from './utils/browserNotify';
import NotificationSettings from './pages/auth/NotificationSettings.jsx';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import ProfileAuth from './pages/auth/ProfileAuth.jsx';
import EditProfile from './pages/auth/EditProfile.jsx';
import ForcePasswordChange from './pages/auth/ForcePasswordChange';
import AdminDashboard from './pages/admin/AdminDashboard';
import { useTheme } from './hooks/useTheme';
import { useNotification } from './hooks/useNotification';
import { suppressAutoPasskeyOnce } from './utils/loginMemory';

// 토큰은 멀쩡한데 소켓 핸드셰이크만 계속 거부당할 때 재연결을 몇 번까지 시도할지.
// 상한이 없으면 '거부 → 확인 → 재연결 → 거부'가 끝없이 돈다.
const SOCKET_AUTH_MAX_RETRY = 3;

function App() {
    // ---------------------------------------------------------
    // [1] 상태 관리 (State)
    // ---------------------------------------------------------
    const SESSION_TIMEOUT = 60 * 60 * 1000; // 1시간

    // localStorage는 렌더링 전에도 동기적으로 읽을 수 있으므로 effect 없이 lazy initializer로 세션 복구
    const [auth, setAuth] = useState(() => {
        const token = localStorage.getItem('token');
        const storedUser = localStorage.getItem('user');
        const lastActivity = localStorage.getItem('lastActivity');

        if (token && storedUser) {
            const now = Date.now();
            if (lastActivity && now - parseInt(lastActivity, 10) > SESSION_TIMEOUT) {
                console.log('⏰ 세션 만료. 자동 로그아웃.');
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                localStorage.removeItem('lastActivity');
            } else {
                localStorage.setItem('lastActivity', now.toString());
                return { isLoggedIn: true, user: JSON.parse(storedUser), view: 'app' };
            }
        }
        return { isLoggedIn: false, user: null, view: 'login' };
    });

    const [myRole, setMyRole] = useState(/** @type {'cashier'|'kitchen'|null} */ (null));
    const [adminStaffMode, setAdminStaffMode] = useState(false); // 관리자가 캐셔/주방 화면을 미리보기 위해 직원 모드로 전환했는지
    const [prevRole, setPrevRole] = useState(/** @type {'cashier'|'kitchen'|null} */ (null)); // 역할 전환 감지용(렌더링 중 UI 상태 리셋에 사용)
    const [isCashierTaken, setIsCashierTaken] = useState(false);
    const [cashierUserName, setCashierUserName] = useState(null); // 캐셔를 점유 중인 사람 이름
    const [kitchenUserCount, setKitchenUserCount] = useState(0);
    const isKitchenActive = kitchenUserCount > 0;

    // 모달 상태
    const [showSettlement, setShowSettlement] = useState(false);
    const [showHygiene, setShowHygiene] = useState(false);
    const [showInventory, setShowInventory] = useState(false);
    const [showAlerts, setShowAlerts] = useState(false);
    // 관리자 대시보드에서 바로 열 화면(알림을 눌러 들어온 경우). 대시보드가 받아서 쓰고 비운다.
    // 이벤트로 알리면 대시보드가 아직 안 떠 있을 때(알림 설정 화면에서 누른 경우 등) 사라진다.
    const [adminJump, setAdminJump] = useState(/** @type {string|null} */ (null));
    const [showProfile, setShowProfile] = useState(false);
    const [isProfileVerified, setIsProfileVerified] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const { theme, setTheme } = useTheme(); // 모바일 드롭다운의 테마 선택용
    const [isThemeSubOpen, setIsThemeSubOpen] = useState(false); // 테마 하위 메뉴(왼쪽 플라이아웃)

    // 소켓 인증 거부를 HTTP로 되묻는 중인지. 재연결이 몰아칠 때 확인 요청이 겹치는 것을 막는다.
    const authCheckingRef = useRef(false);
    // 토큰은 멀쩡한데 소켓만 계속 거부당하는 경우를 대비한 재시도 상한.
    // 없으면 '거부 → 확인 → 재연결 → 거부'가 끝없이 돈다.
    const socketAuthRetryRef = useRef(0);

    // 역할(화면) 전환 시 사용자 드롭다운/테마 서브메뉴 닫기 (effect 대신 렌더링 중 조정 — react.dev 권장 패턴)
    if (myRole !== prevRole) {
        setPrevRole(myRole);
        setIsDropdownOpen(false);
        setIsThemeSubOpen(false);
    }

    const { notify } = useNotification();

    // ---------------------------------------------------------
    // [2] 인증 및 세션 관리 (Auth & Session)
    // ---------------------------------------------------------
    const handleLogout = useCallback(() => {
        // 서버에 로그아웃을 알려 주방 인원 등 실시간 자리를 바로 비우게 한다.
        // 소켓 신호만으로는 부족하다 — 지금 소켓이 끊겨 있으면(절전에서 막 깨어나 재연결 중 등)
        // 신호가 대기열에 있다가 아래 disconnect()와 함께 버려져, 서버가 1시간 동안 자리를 지킨다.
        // HTTP로도 보낸다. 토큰을 지우기 전에 읽어 둔다.
        // axios가 아니라 fetch인 이유: axios 인터셉터는 401을 '세션 만료'로 보고 로그아웃을 다시 부른다.
        // keepalive는 로그아웃 직후 화면이 바뀌거나 탭이 닫혀도 요청이 끝까지 가게 한다.
        const token = localStorage.getItem('token');
        if (token) {
            void fetch(`${axios.defaults.baseURL}/api/logout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ socket_id: socket.id ?? null }),
                keepalive: true,
            }).catch(() => {
                /* 실패해도 로그아웃은 진행한다. 서버는 유예 시간이 지나면 스스로 정리한다. */
            });
        }
        socket.emit('logout');
        socket.disconnect();
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('lastActivity');

        setAuth({ isLoggedIn: false, user: null, view: 'login' });
        setMyRole(null);
        setAdminStaffMode(false);
        setShowProfile(false);
        setIsProfileVerified(false);
    }, []);

    // 사용자가 직접 로그아웃 버튼을 눌렀을 때 (자동/세션만료 경로와 구분해 성공 안내)
    const handleManualLogout = useCallback(() => {
        notify('로그아웃되었습니다.', { icon: '👋' });
        // 직접 로그아웃했다면 교대 등으로 다른 사람이 쓸 수 있으니, 로그인 화면에서
        // 이전 사용자의 패스키를 자동 호출하지 않는다. 자동/세션만료 로그아웃은
        // 같은 사람이 돌아오는 상황이라 그대로 자동 호출한다.
        suppressAutoPasskeyOnce();
        handleLogout();
    }, [handleLogout, notify]);

    const handleAutoLogout = useCallback(() => {
        notify('보안을 위해 1시간 동안 활동이 없어 자동 로그아웃되었습니다.', { icon: '🔒' });
        handleLogout();
    }, [handleLogout, notify]);

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
            notify('세션이 만료되었습니다. 다시 로그인해주세요.', { icon: '🔒' });
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
            socket.emit(
                'register_user',
                /** @type {any} */ {
                    username: auth.user.username,
                    role: auth.user.role,
                },
            );
        };

        // 소켓 핸드셰이크가 인증 실패로 거부됐을 때.
        //
        // 예전에는 여기서 곧바로 로그아웃시켰는데, 매장 네트워크가 불안정해 재연결이 잦으면
        // 거부 한 번에 근무 중인 직원이 튕겨 나갔다. 소켓 거부는 네트워크·서버 사정으로도
        // 얼마든지 난다. 토큰이 정말 죽었는지는 HTTP가 권위 있게 답하므로 거기에 물어본다.
        //   - HTTP도 401  → axios 인터셉터가 app:session-expired를 쏴 로그아웃된다(아래 effect)
        //   - HTTP는 정상 → 소켓만 일시적으로 막힌 것. 다시 붙인다
        //   - 그 밖(네트워크·503) → 판단 보류. 다시 붙여 보고 다음 기회를 노린다
        //
        // 일시적 네트워크 오류는 type 표시가 없으므로 여기까지 오지 않는다(socket.io가 자동 재시도).
        /** @param {any} err */
        const handleAuthError = async (err) => {
            if (err?.data?.type !== 'auth') return;
            if (authCheckingRef.current) return; // 재연결이 몰아쳐도 확인은 한 번만
            authCheckingRef.current = true;
            socket.disconnect(); // 확인하는 동안 재시도를 멈춘다

            try {
                await axios.get('/api/me', {
                    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
                });
                // 토큰은 살아 있다. 상한 안에서만 다시 붙인다.
                if (socketAuthRetryRef.current < SOCKET_AUTH_MAX_RETRY) {
                    socketAuthRetryRef.current += 1;
                    socket.connect();
                } else {
                    // 계속 거부당한다. 로그아웃시키지는 않는다 — 주문·조회는 HTTP로 계속 된다.
                    notify('실시간 연결이 불안정합니다. 화면을 새로고침해주세요.', {
                        icon: '📡',
                        dedupeKey: 'socket-auth',
                    });
                }
            } catch (/** @type {any} */ httpErr) {
                // 401이면 인터셉터가 이미 로그아웃 절차를 밟는다. 여기서 또 하지 않는다.
                if (httpErr.response?.status !== 401) socket.connect();
            } finally {
                authCheckingRef.current = false;
            }
        };

        // 한 번이라도 정상 연결되면 재시도 카운터를 되돌린다.
        socketAuthRetryRef.current = 0;
        if (socket.connected) registerMyUser();
        else socket.connect(); // 로그인 상태면 소켓 연결 시작 (핸드셰이크에 토큰 전송)
        socket.on('connect', registerMyUser);
        socket.on('connect_error', handleAuthError);

        socket.on('cashier_status', (status) => {
            setIsCashierTaken(status.taken);
            setCashierUserName(status.name);
        });
        socket.on('kitchen_status', (count) => setKitchenUserCount(count));

        // 정해진 시각 알림(공통). 서버가 대상을 방으로 가려서 보내므로 여기서는 그냥 띄운다.
        // 브라우저 알림이 막혀 있으면 앱 안 토스트로라도 보여준다 — 내용을 잃지 않는 게 먼저다.
        socket.on('app_alert', (alert) => {
            if (!showBrowserAlert(alert)) {
                notify(alert.body ? `${alert.title} — ${alert.body}` : alert.title, {
                    icon: '🔔',
                    duration: 0,
                    dedupeKey: `alert-${alert.key}`,
                    // 브라우저 알림 대신 뜬 토스트도 누르면 같은 화면으로 간다.
                    onClick: alert.action ? () => runAlertAction(alert.action) : undefined,
                });
            }
        });

        socket.emit('request_state'); // 현재 상태 요청
        // 캐셔 사용 여부·주방 인원은 바뀔 때만 신호가 온다. 연결이 끊긴 동안 바뀐 것은 다시 오지 않으므로
        // (역할 선택 화면을 띄워 둔 채 화면이 꺼졌다 켜진 경우 등) 돌아오면 현재 상태를 다시 묻는다.
        const offResync = onResync(() => socket.emit('request_state'));

        return () => {
            offResync();
            socket.off('connect', registerMyUser);
            socket.off('connect_error', handleAuthError);
            socket.off('user_count');
            socket.off('cashier_status');
            socket.off('kitchen_status');
            socket.off('app_alert');
        };
    }, [auth.isLoggedIn, auth.user, handleLogout, notify]);

    // 알림을 눌렀을 때 열 화면. 이름과 실제 동작을 여기서 잇는다(utils/browserNotify 참고).
    // 전체 화면(알림 설정·내 정보)이 떠 있으면 그 뒤에 모달이 가려지므로 먼저 닫는다.
    useEffect(() => {
        if (!auth.isLoggedIn) return undefined;
        const toMain = () => {
            setShowAlerts(false);
            setShowProfile(false);
            setIsProfileVerified(false);
        };
        const offs = [
            // 직원용 창은 직원 화면에서만 그려진다. 관리자가 대시보드에서 누른 경우(보내보기 등)는
            // 직원 화면으로 옮겨 연다 — 그대로 두면 눌러도 아무 일도 일어나지 않는다.
            registerAlertAction('open_inventory_count', () => {
                toMain();
                setAdminStaffMode(true);
                setShowInventory(true);
            }),
            registerAlertAction('open_hygiene_check', () => {
                toMain();
                setAdminStaffMode(true);
                setShowHygiene(true);
            }),
            registerAlertAction('open_inventory_status', () => {
                toMain();
                setAdminStaffMode(false);
                setAdminJump('inventory');
            }),
        ];
        return () => offs.forEach((off) => off());
    }, [auth.isLoggedIn]);

    // 서비스 워커를 통해 들어온 동작을 받는다(탭이 닫혀 있을 때 온 푸시를 누른 경우).
    // 로그인 여부와 상관없이 한 번 연결한다 — 받은 동작은 위에서 등록될 때까지 맡아둔다.
    useEffect(() => listenForAlertActions(), []);

    // 캐셔 사용 중 순단(재연결) 시 자리 자동 재선점.
    // 재연결되면 소켓 ID가 바뀌어 서버가 이전 소켓 기준으로 자리를 비워버리므로,
    // 화면은 캐셔인데 서버상 공석이 되어 다른 기기가 선점할 수 있는 틈이 생긴다. (그 반대 방지용)
    useEffect(() => {
        if (myRole !== 'cashier') return;

        const reclaimCashier = () => socket.emit('claim_cashier');
        /** @param {boolean} success */
        const handleReclaimResult = (success) => {
            if (!success) {
                // 끊긴 사이 다른 사용자(다른 계정)가 선점한 경우 — 역할 선택으로 복귀
                notify('연결이 끊긴 사이 다른 기기가 캐셔를 선점했습니다.', { icon: '⚠️' });
                setMyRole(null);
            }
        };

        socket.on('connect', reclaimCashier);
        socket.on('cashier_claimed', handleReclaimResult);
        return () => {
            socket.off('connect', reclaimCashier);
            socket.off('cashier_claimed', handleReclaimResult);
        };
    }, [myRole, notify]);

    // 주방도 같은 이유로 재연결 때 다시 알린다.
    // join_kitchen은 역할을 고르는 순간에만 보냈는데, 순단 후 재연결되면 소켓 ID가 바뀌어
    // 서버는 이 사람을 주방에서 뗀 상태가 된다. 화면은 주방인데 서버상으로는 아무도 없어,
    // 캐셔가 결제완료를 누르면 조리완료까지 넘어가 주문이 주방 목록에서 사라졌다.
    useEffect(() => {
        if (myRole !== 'kitchen') return;

        const rejoinKitchen = () => socket.emit('join_kitchen');
        socket.on('connect', rejoinKitchen);
        return () => {
            socket.off('connect', rejoinKitchen);
        };
    }, [myRole]);

    // ---------------------------------------------------------
    // [4] 렌더링 로직 (Render Logic)
    // ---------------------------------------------------------
    /** @param {any} userData */
    const handleLoginSuccess = (userData) => {
        setAuth({ isLoggedIn: true, user: userData, view: 'app' });
    };

    // 로그인 전 화면 처리
    if (!auth.isLoggedIn) {
        if (auth.view === 'register') {
            return <Register onSwitchToLogin={() => setAuth({ ...auth, view: 'login' })} />;
        }
        return (
            <Login
                onLoginSuccess={handleLoginSuccess}
                onSwitchToRegister={() => setAuth({ ...auth, view: 'register' })}
            />
        );
    }

    // 관리자가 임시 비밀번호를 발급한 계정은 새 비밀번호를 정하기 전까지 앱에 들어갈 수 없다.
    // 임시 비밀번호는 사람 손을 거쳐 전달되므로, 그 상태로 계속 쓰면 계정이 열려 있는 것과 같다.
    if (auth.user.mustChangePassword) {
        return (
            <ForcePasswordChange
                user={auth.user}
                onDone={() => {
                    const updated = { ...auth.user, mustChangePassword: false };
                    localStorage.setItem('user', JSON.stringify(updated));
                    setAuth((prev) => ({ ...prev, user: updated }));
                }}
                onLogout={handleManualLogout}
            />
        );
    }

    // 알림 설정은 역할과 무관하다. 각자 자기 기기에서 켜는 것이라 관리자·직원 모두 들어온다.
    if (showAlerts) {
        return <NotificationSettings onBack={() => setShowAlerts(false)} isAdmin={auth.user.role === 'admin'} />;
    }

    // 관리자 대시보드 (직원 모드로 전환하지 않은 동안만)
    if (auth.user.role === 'admin' && !adminStaffMode) {
        // 본인 확인 통과 후엔 EditProfile 전체 페이지로 전환
        if (showProfile && isProfileVerified) {
            return (
                <EditProfile
                    onBack={() => {
                        setShowProfile(false);
                        setIsProfileVerified(false);
                    }}
                    onLogout={handleManualLogout}
                />
            );
        }
        // 대시보드는 그대로 두고, 본인 확인(ProfileAuth)은 그 위에 모달로 띄운다
        return (
            <>
                <AdminDashboard
                    userName={auth.user.name}
                    onLogout={handleManualLogout}
                    onEditProfile={() => setShowProfile(true)}
                    onEnterStaffMode={() => setAdminStaffMode(true)}
                    onOpenAlerts={() => setShowAlerts(true)}
                    jumpTo={adminJump}
                    onJumped={() => setAdminJump(null)}
                />
                {showProfile && (
                    <ProfileAuth
                        currentUser={auth.user}
                        onSuccess={() => setIsProfileVerified(true)}
                        onCancel={() => setShowProfile(false)}
                    />
                )}
            </>
        );
    }

    // 직원: 본인 확인 통과 후엔 EditProfile 전체 페이지로 전환 (그 전 본인확인 모달은 아래 메인 레이아웃 위에 오버레이로 띄움)
    if (showProfile && isProfileVerified) {
        return (
            <EditProfile
                onBack={() => {
                    setShowProfile(false);
                    setIsProfileVerified(false);
                }}
                onLogout={handleManualLogout}
            />
        );
    }

    // 직원 화면 컨텐츠 분기
    const renderContent = () => {
        if (myRole === 'cashier') {
            return <Cashier onlyOrder={false} isCashier={isKitchenActive} />;
        }
        if (myRole === 'kitchen') {
            return <Kitchen />;
        }

        return (
            <RoleSelection
                onSelectRole={(role) => {
                    if (role === 'kitchen') socket.emit('join_kitchen');
                    setMyRole(role);
                }}
                isCashierTaken={isCashierTaken}
                cashierUserName={cashierUserName}
                kitchenUserCount={kitchenUserCount}
                isAdmin={auth.user.role === 'admin'}
            />
        );
    };

    return (
        <div>
            {/* 전역 스타일 */}
            <style>
                {`
                body { margin: 0; background-color: var(--bg-color, #f4f6f8); color: var(--text-primary, #333); transition: background-color 0.3s ease, color 0.3s ease; }
                
                /* 상단 플로팅 헤더 */
                .global-top-header { position: absolute; top: 15px; left: 20px; right: 20px; z-index: 9999; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; }
                
                /* btn-user-dropdown과 두께(패딩/글자크기/보더)를 맞춤 — 옆에 나란히 있을 때 높이가 어긋나지 않게 */
                .btn-global-action { padding: 6px 12px; color: white; border: 1px solid transparent; border-radius: 20px; font-weight: bold; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.15); transition: transform 0.1s; font-size: 0.85rem; }
                .btn-global-action:active { transform: scale(0.95); }
                .btn-settle { background-color: var(--success); }
                .btn-hygiene { background-color: var(--accent); }
                .btn-inventory { background-color: var(--neutral); }
                .btn-back-role { background-color: var(--neutral); margin-right: auto; }

                /* 이름 드롭다운 — PC/모바일 공통(화면 크기와 무관하게 동일한 형태) */
                .user-menu { position: relative; }

                .btn-user-dropdown { padding: 6px 12px; border-radius: 20px; border: 1px solid var(--border-color, #ccc); background-color: var(--card-bg, #fff); color: var(--text-primary, #333); font-weight: bold; font-size: 0.85rem; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.1); display: flex; align-items: center; gap: 5px; }

                .dropdown-panel { position: absolute; top: 110%; right: 0; background-color: var(--card-bg, #fff); border: 1px solid var(--border-color, #ddd); border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); display: flex; flex-direction: column; overflow: visible; width: max-content; z-index: 10000; }

                .dropdown-item { padding: 12px 15px; background: none; border: none; border-bottom: 1px solid var(--border-color, #eee); text-align: left; font-size: 0.9rem; font-weight: bold; color: var(--text-primary, #333); cursor: pointer; transition: background-color 0.2s; white-space: nowrap; }
                .dropdown-item:last-child { border-bottom: none; }
                /* 테마 변경은 하위 메뉴를 담는 div 안에 들어 있어서 그 div의 마지막 자식이 된다.
                   실제로는 메뉴의 첫 줄이므로 위 규칙에 걸려 사라진 아래 선을 되살린다. */
                .dropdown-theme-wrap > .dropdown-item { border-bottom: 1px solid var(--border-color, #eee); }
                .dropdown-item.logout { color: var(--danger); }
                .dropdown-item:active { background-color: var(--border-color, #f0f0f0); }
                .dropdown-item.active { color: var(--accent); font-weight: 800; }
                .dropdown-theme-wrap { position: relative; }
                .dropdown-theme-toggle { display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box; }
                .dropdown-sub-arrow { color: var(--text-secondary, #999); font-size: 1.1rem; line-height: 1; }
                .dropdown-submenu { position: absolute; right: calc(100% + 6px); top: 0; background-color: var(--card-bg, #fff); border: 1px solid var(--border-color, #ddd); border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,0.18); display: flex; flex-direction: column; overflow: hidden; min-width: 150px; z-index: 10001; }

                @media (max-width: 768px) {
                    .global-top-header { top: 10px; right: 10px; gap: 8px; left: 10px; }
                    .btn-global-action { padding: 6px 10px; }
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
                        <button onClick={() => setShowSettlement(true)} className="btn-global-action btn-settle">
                            💰 시재 점검
                        </button>
                    )}

                    {/* 위생 점검은 역할과 무관한 작업이다. 시재 점검 옆(캐셔 전용)에 두면
                        캐셔로 들어간 사람만 닿을 수 있으므로, 역할을 고르기 전 화면에 둔다. */}
                    {!myRole && (
                        <button onClick={() => setShowHygiene(true)} className="btn-global-action btn-hygiene">
                            🧼 위생 점검
                        </button>
                    )}

                    {/* 재고 조사도 역할과 무관하다. 위생 점검과 같은 자리에 둔다. */}
                    {!myRole && (
                        <button onClick={() => setShowInventory(true)} className="btn-global-action btn-inventory">
                            📦 재고 조사
                        </button>
                    )}

                    {/* 이름 드롭다운 — PC/모바일 공통 */}
                    <div className="user-menu">
                        <button
                            className="btn-user-dropdown"
                            onClick={() => {
                                setIsDropdownOpen(!isDropdownOpen);
                                setIsThemeSubOpen(false);
                            }}
                        >
                            👤 {auth.user.name}님 ▼
                        </button>

                        {/* 드롭다운 열렸을 때 나오는 메뉴들 */}
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
                                {auth.user.role === 'admin' && adminStaffMode && (
                                    <button
                                        onClick={() => {
                                            if (myRole === 'cashier') socket.emit('release_cashier');
                                            if (myRole === 'kitchen') socket.emit('leave_kitchen');
                                            setMyRole(null);
                                            setAdminStaffMode(false);
                                            setIsDropdownOpen(false);
                                        }}
                                        className="dropdown-item"
                                    >
                                        🛡️ 관리자 대시보드
                                    </button>
                                )}
                                <button
                                    onClick={() => {
                                        setShowProfile(true);
                                        setIsDropdownOpen(false);
                                    }}
                                    className="dropdown-item"
                                >
                                    ⚙️ 내 정보
                                </button>
                                <button
                                    onClick={() => {
                                        setShowAlerts(true);
                                        setIsDropdownOpen(false);
                                    }}
                                    className="dropdown-item"
                                >
                                    🔔 알림 설정
                                </button>
                                <button
                                    onClick={() => {
                                        handleManualLogout();
                                        setIsDropdownOpen(false);
                                    }}
                                    className="dropdown-item logout"
                                >
                                    🚪 로그아웃
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 시재 점검 모달 */}
            {showSettlement && <CashSettlement onClose={() => setShowSettlement(false)} />}

            {/* 위생 점검 모달 */}
            {showHygiene && <HygieneCheck onClose={() => setShowHygiene(false)} />}
            {showInventory && <InventoryCount onClose={() => setShowInventory(false)} />}

            {/* 메인 화면 렌더링 */}
            {renderContent()}

            {/* 본인 확인 모달: 현재 페이지를 그대로 두고 그 위에 오버레이로 띄움 */}
            {showProfile && !isProfileVerified && (
                <ProfileAuth
                    currentUser={auth.user}
                    onSuccess={() => setIsProfileVerified(true)}
                    onCancel={() => setShowProfile(false)}
                />
            )}
        </div>
    );
}

export default App;
