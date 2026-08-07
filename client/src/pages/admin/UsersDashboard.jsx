import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import ThemeToggle from '../../components/ThemeToggle';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { useNotification } from '../../hooks/useNotification';

/**
 * @param {object} props
 * @param {() => void} props.onBack
 */
function UsersDashboard({ onBack }) {
    const { notify, confirm } = useNotification();
    // ---------------------------------------------------------
    // [1] 상태 관리 (State)
    // ---------------------------------------------------------
    const [users, setUsers] = useState(/** @type {import('../../types').User[]} */ ([]));
    // localStorage는 렌더링 전에도 동기적으로 읽을 수 있으므로 effect 없이 lazy initializer로 초기화
    const [currentUserId] = useState(() => {
        const userStr = localStorage.getItem('user');
        return userStr ? JSON.parse(userStr).id : null;
    });

    // ---------------------------------------------------------
    // [2] API 및 데이터 처리
    // ---------------------------------------------------------
    const getAuthHeader = () => ({
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });

    const fetchUsers = useCallback(async () => {
        try {
            const res = await axios.get('/api/admin/users', getAuthHeader());
            setUsers(res.data);
        } catch {
            notify('직원 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', {
                icon: '⚠️',
                dedupeKey: 'load-users',
            });
        }
    }, [notify]);

    useEffect(() => {
        // fetchUsers는 useCallback으로 메모이즈된 비동기 함수라 setState가 await 이후에만 일어남(effect 본문에서 동기 호출 아님) — 규칙 오탐.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void fetchUsers();
    }, [fetchUsers]);

    /**
     * @param {string} id
     * @param {import('../../types').Role} newRole
     */
    const handleRoleChange = async (id, newRole) => {
        if (
            !(await confirm(`정말 권한을 ${newRole}(으)로 변경하시겠습니까?`, {
                title: '권한 변경',
                confirmText: '변경',
            }))
        )
            return;
        try {
            await axios.patch(`/api/admin/users/${id}/role`, { role: newRole }, getAuthHeader());
            notify('변경되었습니다.', { icon: '✅' });
            await fetchUsers();
        } catch (/** @type {any} */ err) {
            notify(err.response?.data?.message || '변경 실패', { icon: '⚠️' });
        }
    };

    /** @param {import('../../types').User} targetUser */
    const handleDeleteUser = async (targetUser) => {
        if (targetUser.role === 'pending') {
            if (
                !(await confirm(`'${targetUser.name}' 님의 가입 신청을 거절하고 계정을 삭제하시겠습니까?`, {
                    title: '가입 거절',
                    confirmText: '거절·삭제',
                    danger: true,
                }))
            )
                return;
        } else if (targetUser.role === 'staff') {
            if (
                !(await confirm(`정말 직원 '${targetUser.name}' 님의 계정을 삭제하시겠습니까?`, {
                    title: '직원 계정 삭제',
                    confirmText: '삭제',
                    danger: true,
                }))
            )
                return;
            if (
                !(await confirm('직원의 계정 및 관련 데이터가 영구적으로 삭제됩니다.\n그래도 삭제하시겠습니까?', {
                    title: '⚠️ 최종 경고',
                    confirmText: '영구 삭제',
                    danger: true,
                }))
            )
                return;
        }

        try {
            await axios.delete(`/api/admin/users/${targetUser.id}`, getAuthHeader());
            notify('계정이 완전히 삭제되었습니다.', { icon: '✅' });
            await fetchUsers();
        } catch (/** @type {any} */ err) {
            notify(err.response?.data?.message || '계정 삭제에 실패했습니다.', { icon: '⚠️' });
        }
    };

    // 현재 접속한 관리자를 목록 최상단으로 정렬
    const displayUsers = [...users].sort((a, b) => {
        if (a.id === currentUserId) return -1;
        if (b.id === currentUserId) return 1;
        return 0;
    });

    // ---------------------------------------------------------
    // [3] 렌더링 (Render)
    // ---------------------------------------------------------
    return (
        <div className="users-dashboard-wrapper">
            <style>
                {`
                /* 전체 레이아웃 */
                .users-dashboard-wrapper { padding: 20px; background-color: var(--bg-color, #f4f6f8); min-height: 100dvh; display: flex; flex-direction: column; box-sizing: border-box; transition: background-color 0.3s ease; }
                
                /* 헤더 영역 */
                .users-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: nowrap; gap: 15px; }
                .header-left { display: flex; align-items: center; gap: 15px; }
                .users-title { margin: 0; color: var(--text-primary, #333); font-size: 1.8rem; white-space: nowrap; }
                .theme-wrapper { display: flex; align-items: center; }

                /* 컨텐츠 영역 (PC 테이블) */
                .users-container { overflow: hidden; } /* 카드 외형(배경·테두리·라운드·그림자)은 공용 <Card>가 담당, 표 모서리 클리핑만 유지 */
                .users-table-view { display: table; width: 100%; border-collapse: collapse; }
                .users-table-view th { padding: 15px; color: var(--text-secondary, #666); text-align: left; border-bottom: 2px solid var(--border-color, #ddd); background-color: var(--bg-color, #fafafa); white-space: nowrap; font-weight: bold; }
                .users-table-view td { padding: 15px; color: var(--text-primary, #333); border-bottom: 1px solid var(--border-color, #eee); white-space: nowrap; }
                
                .users-card-view { display: none; } 

                /* 뱃지 및 버튼 스타일 */
                .role-badge { padding: 5px 10px; border-radius: var(--radius-sm); font-size: 0.8rem; font-weight: bold; display: inline-block; }
                .role-admin { background-color: var(--accent-bg); color: #1565c0; }
                .role-staff { background-color: var(--success-bg); color: var(--success); }
                .role-pending { background-color: var(--warning-bg); color: #ef6c00; }
                
                .btn-action-base { padding: 6px 10px; border-radius: var(--radius-sm); font-size: 0.8rem; font-weight: bold; border: none; cursor: pointer; color: white; transition: transform 0.1s; }
                .btn-approve { background-color: #4caf50; } .btn-demote { background-color: #9e9e9e; } .btn-promote { background-color: #2196f3; } .btn-wait { background-color: var(--warning); } .btn-delete { background-color: #d32f2f; }
                .my-account-label { color: var(--text-blue, var(--accent)); font-weight: bold; font-size: 0.9rem; padding: 8px; }

                /* 다크모드 오버라이드 */
                [data-theme='dark'] .role-admin { background-color: rgba(21, 101, 192, 0.2); color: #64b5f6; }
                [data-theme='dark'] .role-staff { background-color: rgba(46, 125, 50, 0.2); color: #81c784; }
                [data-theme='dark'] .role-pending { background-color: rgba(239, 108, 0, 0.2); color: #ffb74d; }
                [data-theme='dark'] .my-account-label { color: #4facfe; }

                /* 모바일 반응형 */
                @media (max-width: 768px) {
                    .users-dashboard-wrapper { padding: 15px; }
                    .users-header { position: relative; flex-direction: column; align-items: flex-start; gap: 12px; }
                    .header-left { width: 100%; gap: 10px; padding-right: 40px; box-sizing: border-box; }
                    .users-title { font-size: 1.5rem; }
                    .theme-wrapper { position: absolute; top: 0; right: 0; }

                    .users-container { background-color: transparent; box-shadow: none; border: none; }
                    .users-table-view { display: none; } 
                    .users-card-view { display: flex; flex-direction: column; gap: 15px; } 
                    
                    /* 모바일 카드 스타일 */
                    .user-card { background-color: var(--card-bg, white); border-radius: var(--radius-lg); padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); display: flex; flex-direction: column; gap: 10px; border: 1px solid var(--border-color, transparent); }
                    .user-card-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed var(--border-color, #eee); padding-bottom: 10px; }
                    .user-name { font-size: 1.1rem; font-weight: bold; color: var(--text-primary, #333); }
                    .user-id { font-size: 0.85rem; color: var(--text-secondary, #888); }
                    .user-card-body { display: flex; flex-direction: column; gap: 8px; font-size: 0.9rem; color: var(--text-secondary, #555); }
                    .user-card-actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: nowrap; overflow-x: auto; }
                    .btn-action-base { flex: 1; padding: 10px 2px; text-align: center; white-space: nowrap; }
                    .my-account-label { width: 100%; text-align: right; }
                }
                `}
            </style>

            <div className="users-header">
                <div className="header-left">
                    <Button variant="neutral" icon="⬅" onClick={onBack}>
                        뒤로
                    </Button>
                    <h1 className="users-title">👥 직원 관리</h1>
                </div>
                <div className="theme-wrapper">
                    <ThemeToggle />
                </div>
            </div>

            <Card flush className="users-container">
                {/* 1. PC 뷰: 테이블 형식 */}
                <table className="users-table-view">
                    <thead>
                        <tr>
                            <th>이름</th>
                            <th>아이디</th>
                            <th>가입일</th>
                            <th>현재 권한</th>
                            <th>권한 변경</th>
                        </tr>
                    </thead>
                    <tbody>
                        {displayUsers.map((user) => (
                            <tr key={user.id}>
                                <td>
                                    <strong>{user.name}</strong>
                                </td>
                                <td>{user.username}</td>
                                <td>{new Date(user.created_at).toLocaleDateString()}</td>
                                <td>
                                    <span className={`role-badge ${getRoleClass(user.role)}`}>
                                        {getRoleName(user.role)}
                                    </span>
                                </td>
                                <td>
                                    <div style={{ display: 'flex', gap: '5px' }}>
                                        <RenderActionButtons
                                            user={user}
                                            handleRoleChange={handleRoleChange}
                                            handleDeleteUser={handleDeleteUser}
                                            currentUserId={currentUserId}
                                        />
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                {/* 2. 모바일 뷰: 카드 형식 */}
                <div className="users-card-view">
                    {displayUsers.map((user) => (
                        <div key={user.id} className="user-card">
                            <div className="user-card-header">
                                <div>
                                    <div className="user-name">{user.name}</div>
                                    <div className="user-id">@{user.username}</div>
                                </div>
                                <span className={`role-badge ${getRoleClass(user.role)}`}>
                                    {getRoleName(user.role)}
                                </span>
                            </div>
                            <div className="user-card-body">
                                <div>📅 가입일: {new Date(user.created_at).toLocaleDateString()}</div>
                            </div>
                            <div className="user-card-actions">
                                <RenderActionButtons
                                    user={user}
                                    handleRoleChange={handleRoleChange}
                                    handleDeleteUser={handleDeleteUser}
                                    currentUserId={currentUserId}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </Card>
        </div>
    );
}

// ---------------------------------------------------------
// [4] 헬퍼 컴포넌트 및 함수
// ---------------------------------------------------------
/**
 * @param {object} props
 * @param {any} props.user  직원 레코드 (id/username/name/role)
 * @param {(id: any, newRole: import('../../types').Role) => void} props.handleRoleChange
 * @param {(id: any) => void} props.handleDeleteUser
 * @param {any} props.currentUserId  본인 계정은 버튼 대신 '내 계정' 표시
 */
function RenderActionButtons({ user, handleRoleChange, handleDeleteUser, currentUserId }) {
    if (user.id === currentUserId) return <div className="my-account-label">👤 내 계정</div>;

    return (
        <>
            {user.role === 'pending' && (
                <button className="btn-action-base btn-approve" onClick={() => handleRoleChange(user.id, 'staff')}>
                    ✅ 승인
                </button>
            )}
            {user.role !== 'staff' && user.role !== 'pending' && (
                <button className="btn-action-base btn-demote" onClick={() => handleRoleChange(user.id, 'staff')}>
                    ⬇ 직원 강등
                </button>
            )}
            {user.role !== 'admin' && (
                <button className="btn-action-base btn-promote" onClick={() => handleRoleChange(user.id, 'admin')}>
                    ⬆ 관리자 승급
                </button>
            )}
            {user.role !== 'pending' && (
                <button className="btn-action-base btn-wait" onClick={() => handleRoleChange(user.id, 'pending')}>
                    ⏸ 대기로
                </button>
            )}
            {user.role !== 'admin' && (
                <button className="btn-action-base btn-delete" onClick={() => handleDeleteUser(user)}>
                    🗑️ 삭제
                </button>
            )}
        </>
    );
}

/** @param {string} role */
function getRoleName(role) {
    if (role === 'admin') return '👑 관리자';
    if (role === 'staff') return '☕ 직원';
    return '⏳ 대기중';
}

/** @param {string} role */
function getRoleClass(role) {
    if (role === 'admin') return 'role-admin';
    if (role === 'staff') return 'role-staff';
    return 'role-pending';
}

export default UsersDashboard;
