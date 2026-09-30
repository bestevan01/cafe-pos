import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { socket } from '../utils/socket';
import { useTheme } from '../hooks/useTheme';
import { useNotification } from '../hooks/useNotification';

/**
 * @typedef {object} AdminMenuActions
 * @property {string} userName
 * @property {() => void} onLogout
 * @property {() => void} onEditProfile
 * @property {() => void} onEnterStaffMode  캐셔/주방 화면으로 전환
 * @property {() => void} onOpenAlerts  알림 설정 열기
 */

const AdminMenuContext = createContext(/** @type {AdminMenuActions|null} */ (null));

/**
 * AdminDashboard가 한 번 감싸 두면 그 아래 어느 화면에서든 <AdminUserMenu />만 놓으면 된다.
 * 하위 화면(고급 분석, 품목 관리 등)까지 핸들러를 일일이 내려보내지 않기 위함.
 * @param {AdminMenuActions & {children: import('react').ReactNode}} props
 */
export function AdminMenuProvider({ children, ...actions }) {
    return <AdminMenuContext.Provider value={actions}>{children}</AdminMenuContext.Provider>;
}

/**
 * 관리자 화면 우측 상단의 이름 드롭다운. 메인과 모든 하위 화면에서 같은 메뉴를 쓴다.
 *
 * 모바일 하위 화면은 헤더에 뒤로 버튼과 제목이 함께 있어 이름까지 넣을 자리가 없다.
 * 그래서 좁은 화면에서는 버튼만 테마 버튼과 같은 크기의 👤 동그라미로 줄인다(메뉴 내용은 같다).
 * 메인 화면은 헤더가 따로 한 줄을 차지해 자리가 넉넉하므로 showName으로 이름을 늘 보인다.
 * @param {{showName?: boolean}} props
 */
export default function AdminUserMenu({ showName = false }) {
    const actions = useContext(AdminMenuContext);
    const { notify, confirm } = useNotification();
    const { theme, setTheme } = useTheme();
    const [isOpen, setIsOpen] = useState(false);
    const [isThemeSubOpen, setIsThemeSubOpen] = useState(false);
    const menuRef = useRef(/** @type {HTMLDivElement|null} */ (null));

    // 바깥을 누르면 닫는다. 하위 화면에서는 메뉴가 표·폼 위를 덮기 때문에 열린 채로 남으면 방해된다.
    useEffect(() => {
        if (!isOpen) return;
        /** @param {Event} e */
        const handle = (e) => {
            if (menuRef.current && !menuRef.current.contains(/** @type {Node} */ (e.target))) {
                setIsOpen(false);
                setIsThemeSubOpen(false);
            }
        };
        document.addEventListener('pointerdown', handle);
        return () => document.removeEventListener('pointerdown', handle);
    }, [isOpen]);

    if (!actions) return null;
    const { userName, onLogout, onEditProfile, onEnterStaffMode, onOpenAlerts } = actions;

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

    /** 메뉴를 닫고 동작을 실행한다. @param {() => void} fn */
    const pick = (fn) => () => {
        setIsOpen(false);
        setIsThemeSubOpen(false);
        fn();
    };

    return (
        <div className={`user-menu${showName ? '' : ' compact'}`} ref={menuRef}>
            <style>
                {`
                /* 이름 드롭다운 — PC/모바일 공통(화면 크기와 무관하게 동일한 형태) */
                .user-menu { position: relative; }

                .btn-user-dropdown { padding: 6px 12px; border-radius: 20px; border: 1px solid var(--border-color, #ccc); background-color: var(--card-bg, #fff); color: var(--text-primary, #333); font-weight: bold; font-size: 0.85rem; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.1); display: flex; align-items: center; gap: 5px; white-space: nowrap; }

                /* min-width 고정값 대신 가장 긴 항목(캐셔/주방 화면, 캐셔 강제 해제)에 맞춰 너비 자동 결정 */
                .dropdown-panel { position: absolute; top: 110%; right: 0; background-color: var(--card-bg, #fff); border: 1px solid var(--border-color, #ddd); border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); display: flex; flex-direction: column; overflow: visible; width: max-content; z-index: 10000; }

                .dropdown-item { padding: 12px 15px; background: none; border: none; border-bottom: 1px solid var(--border-color, #eee); text-align: left; font-size: 0.9rem; font-weight: bold; color: var(--text-primary, #333); cursor: pointer; transition: background-color 0.2s; white-space: nowrap; }
                .dropdown-item:last-child { border-bottom: none; }
                /* 테마 변경은 하위 메뉴를 담는 div 안에 들어 있다. 하위 메뉴가 접혀 있으면 그 div의
                   유일한 자식이라 위 :last-child 규칙에 걸려 아래 선이 사라진다(펼치면 다시 생긴다).
                   실제로는 메뉴의 첫 줄이므로 선을 되살린다. */
                .dropdown-theme-wrap > .dropdown-item { border-bottom: 1px solid var(--border-color, #eee); }
                .dropdown-item.logout, .dropdown-item.danger { color: var(--danger); }
                .dropdown-item:active { background-color: var(--border-color, #f0f0f0); }
                .dropdown-item.active { color: var(--accent); font-weight: 800; }
                .dropdown-theme-wrap { position: relative; }
                /* dropdown-theme-wrap에 한 겹 더 감싸져 있어 flex stretch를 못 받고 내용물 크기로만 줄어들던 문제 수정 */
                /* + 화살표를 오른쪽 끝(space-between)이 아니라 텍스트 바로 옆에 붙임 */
                .dropdown-theme-toggle { display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box; }
                .dropdown-sub-arrow { color: var(--text-secondary, #999); font-size: 1.1rem; line-height: 1; }
                .dropdown-submenu { position: absolute; right: calc(100% + 6px); top: 0; background-color: var(--card-bg, #fff); border: 1px solid var(--border-color, #ddd); border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,0.18); display: flex; flex-direction: column; overflow: hidden; min-width: 150px; z-index: 10001; }

                /* 하위 화면의 좁은 헤더: 테마 버튼(ThemeToggle 모바일 32px)과 같은 동그라미로 줄인다.
                   페이지마다 헤더 배치가 그 크기에 맞춰져 있어 이보다 크면 제목을 덮거나 화면 밖으로 밀린다. */
                @media (max-width: 768px) {
                    .user-menu.compact .btn-user-dropdown { width: 32px; height: 32px; padding: 0; border-radius: 50%; justify-content: center; font-size: 1rem; }
                    .user-menu.compact .btn-user-label { display: none; }
                }
                `}
            </style>

            <button
                className="btn-user-dropdown"
                aria-label={`${userName}님 메뉴`}
                title={`${userName}님 메뉴`}
                onClick={() => {
                    setIsOpen(!isOpen);
                    setIsThemeSubOpen(false);
                }}
            >
                👤<span className="btn-user-label">{userName}님 ▼</span>
            </button>

            {isOpen && (
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
                    <button onClick={pick(onEnterStaffMode)} className="dropdown-item">
                        🛒 캐셔/주방 화면
                    </button>
                    <button onClick={pick(onEditProfile)} className="dropdown-item">
                        ⚙️ 내 정보
                    </button>
                    <button onClick={pick(onOpenAlerts)} className="dropdown-item">
                        🔔 알림 설정
                    </button>
                    <button onClick={pick(() => void handleForceReleaseCashier())} className="dropdown-item danger">
                        🚨 캐셔 강제 해제
                    </button>
                    <button onClick={pick(onLogout)} className="dropdown-item logout">
                        🚪 로그아웃
                    </button>
                </div>
            )}
        </div>
    );
}
