import { useState, useEffect } from 'react';
import axios from 'axios';
import ThemeToggle from '../../components/ThemeToggle';

function UsersDashboard({ onBack }) {
    const [users, setUsers] = useState([]);
    const [currentUserId, setCurrentUserId] = useState(null);

    useEffect(() => {
        const userStr = localStorage.getItem('user');
        if (userStr) setCurrentUserId(JSON.parse(userStr).id);
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        try {
            const res = await axios.get('/api/admin/users');
            setUsers(res.data);
        } catch (err) {
            console.error('회원 목록 로딩 실패');
        }
    };

    const handleRoleChange = async (id, newRole) => {
        if (!window.confirm(`정말 권한을 ${newRole}(으)로 변경하시겠습니까?`)) return;
        try {
            await axios.patch(`/api/admin/users/${id}/role`, { role: newRole });
            alert('변경되었습니다.');
            fetchUsers();
        } catch (err) {
            alert('변경 실패');
        }
    };

    const handleDeleteUser = async (targetUser) => {
        if (targetUser.role === 'pending') {
            if (!window.confirm(`'${targetUser.name}' 님의 가입 신청을 거절하고 계정을 삭제하시겠습니까?`)) return;
        }
        else if (targetUser.role === 'staff') {
            const firstConfirm = window.confirm(`정말 직원 '${targetUser.name}' 님의 계정을 삭제하시겠습니까?`);
            if (!firstConfirm) return;

            const secondConfirm = window.confirm('⚠️ [최종 경고] 직원의 계정 및 관련 데이터가 영구적으로 삭제됩니다.\n그래도 삭제하시겠습니까?');
            if (!secondConfirm) return;
        }

        try {
            await axios.delete(`/api/admin/users/${targetUser.id}`);
            alert('✅ 계정이 완전히 삭제되었습니다.');
            fetchUsers();
        } catch (err) {
            alert('계정 삭제에 실패했습니다.');
        }
    };


    const displayUsers = [...users].sort((a, b) => {
        if (a.id === currentUserId) return -1;
        if (b.id === currentUserId) return 1;
        return 0;
    });

    return (
        <div className="users-dashboard-wrapper">
            <style>
                {`
                .users-dashboard-wrapper {
                    padding: 20px;
                    background-color: var(--bg-color, #f4f6f8);
                    min-height: 100vh;
                    display: flex;
                    flex-direction: column;
                    box-sizing: border-box;
                    transition: background-color 0.3s ease;
                }
                
                .users-header {
                    display: flex; justify-content: space-between; align-items: center; 
                    margin-bottom: 20px; flex-wrap: nowrap; gap: 15px;
                }
                .header-left { display: flex; align-items: center; gap: 15px; }
                .users-title { margin: 0; color: var(--text-primary, #333); font-size: 1.8rem; white-space: nowrap; }
                
                /* 🌟 공통 뒤로가기 버튼 md 둥글기 적용 */
                .btn-back { padding: 10px 15px; background-color: #6c757d; color: white; border: none; border-radius: var(--radius-md); cursor: pointer; font-weight: bold; white-space: nowrap; }
                
                .theme-wrapper { display: flex; align-items: center; }

                /* 🌟 PC 테이블 래퍼 (배경 카드) lg 둥글기 적용 */
                .users-container {
                    background-color: var(--card-bg, white);
                    border-radius: var(--radius-lg);
                    box-shadow: 0 4px 15px rgba(0,0,0,0.05);
                    overflow: hidden; 
                    border: 1px solid var(--border-color, transparent);
                }

                .users-table-view { display: table; width: 100%; border-collapse: collapse; }
                .users-table-view th { 
                    padding: 15px; color: var(--text-secondary, #666); text-align: left; 
                    border-bottom: 2px solid var(--border-color, #ddd); background-color: var(--bg-color, #fafafa); 
                    white-space: nowrap; font-weight: bold; 
                }
                .users-table-view td { 
                    padding: 15px; color: var(--text-primary, #333); 
                    border-bottom: 1px solid var(--border-color, #eee); white-space: nowrap;
                }

                .users-card-view { display: none; } 

                /* 🌟 작은 뱃지류는 sm 둥글기 적용 */
                .role-badge { padding: 5px 10px; border-radius: var(--radius-sm); font-size: 0.8rem; font-weight: bold; display: inline-block; }
                .role-admin { background-color: #e3f2fd; color: #1565c0; }
                .role-staff { background-color: #e8f5e9; color: #2e7d32; }
                .role-pending { background-color: #fff3e0; color: #ef6c00; }

                [data-theme='dark'] .role-admin { background-color: rgba(21, 101, 192, 0.2); color: #64b5f6; }
                [data-theme='dark'] .role-staff { background-color: rgba(46, 125, 50, 0.2); color: #81c784; }
                [data-theme='dark'] .role-pending { background-color: rgba(239, 108, 0, 0.2); color: #ffb74d; }

                /* 🌟 테이블 안의 액션 버튼들도 sm 둥글기 적용 */
                .btn-action-base { padding: 6px 10px; border-radius: var(--radius-sm); font-size: 0.8rem; font-weight: bold; border: none; cursor: pointer; color: white; transition: transform 0.1s; }
                .btn-action-base:active { transform: scale(0.95); }
                .btn-approve { background-color: #4caf50; }
                .btn-demote { background-color: #9e9e9e; }
                .btn-promote { background-color: #2196f3; }
                .btn-wait { background-color: #ff9800; }
                .btn-delete { background-color: #d32f2f; }
                
                .my-account-label { color: var(--text-blue, #007bff); font-weight: bold; font-size: 0.9rem; padding: 8px; }
                [data-theme='dark'] .my-account-label { color: #4facfe; }

                /* 📱 모바일 화면 최적화 */
                @media (max-width: 768px) {
                    .users-dashboard-wrapper { padding: 15px; }
                    
                    .users-header { position: relative; flex-direction: column; align-items: flex-start; gap: 12px; }
                    .header-left { width: 100%; gap: 10px; padding-right: 40px; box-sizing: border-box; }
                    .users-title { font-size: 1.5rem; }
                    .btn-back { padding: 8px 12px; font-size: 0.85rem; }
                    .theme-wrapper { position: absolute; top: 0; right: 0; height: 36px; display: flex; align-items: center; }

                    .users-container { background-color: transparent; box-shadow: none; border: none; }
                    .users-table-view { display: none; } 
                    .users-card-view { display: flex; flex-direction: column; gap: 15px; } 
                    
                    /* 🌟 모바일 개별 카드들도 lg 둥글기 적용 */
                    .user-card {
                        background-color: var(--card-bg, white);
                        border-radius: var(--radius-lg); padding: 20px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.05);
                        display: flex; flex-direction: column; gap: 10px;
                        border: 1px solid var(--border-color, transparent);
                    }
                    .user-card-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed var(--border-color, #eee); padding-bottom: 10px; }
                    .user-name { font-size: 1.1rem; font-weight: bold; color: var(--text-primary, #333); }
                    .user-id { font-size: 0.85rem; color: var(--text-secondary, #888); }
                    .user-card-body { display: flex; flex-direction: column; gap: 8px; font-size: 0.9rem; color: var(--text-secondary, #555); }
                    
                    .user-card-actions { 
                        display: flex; 
                        gap: 6px; 
                        margin-top: 10px; 
                        flex-wrap: nowrap; 
                        overflow-x: auto; 
                    }
                    
                    /* 🌟 모바일 액션 버튼은 살짝 크니까 sm(또는 md) 적용. 여기선 sm으로 일관성 유지 */
                    .btn-action-base { 
                        flex: 1; 
                        padding: 10px 2px; 
                        text-align: center; 
                        border-radius: var(--radius-sm); 
                        font-size: 0.8rem; 
                        white-space: nowrap; 
                    }
                    
                    .my-account-label { width: 100%; text-align: right; }
                }
                `}
            </style>

            <div className="users-header">
                <div className="header-left">
                    <button onClick={onBack} className="btn-back">⬅ 뒤로</button>
                    <h1 className="users-title">👥 직원 관리</h1>
                </div>
                <div className="theme-wrapper">
                    <ThemeToggle />
                </div>
            </div>

            <div className="users-container">

                {/* 1. PC 뷰: 기존 테이블 형식 */}
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
                    {displayUsers.map(user => (
                        <tr key={user.id}>
                            <td><strong>{user.name}</strong></td>
                            <td>{user.username}</td>
                            <td>{new Date(user.created_at).toLocaleDateString()}</td>
                            <td>
                                <span className={`role-badge ${getRoleClass(user.role)}`}>
                                    {getRoleName(user.role)}
                                </span>
                            </td>
                            <td>
                                <div style={{display: 'flex', gap: '5px'}}>
                                    {RenderActionButtons(user, handleRoleChange, handleDeleteUser, currentUserId)}
                                </div>
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>

                {/* 2. 모바일 뷰: 카드 형식 */}
                <div className="users-card-view">
                    {displayUsers.map(user => (
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
                                {RenderActionButtons(user, handleRoleChange, handleDeleteUser, currentUserId)}
                            </div>
                        </div>
                    ))}
                </div>

            </div>
        </div>
    );
}

// 버튼 렌더링 함수
function RenderActionButtons(user, handleRoleChange, handleDeleteUser, currentUserId = null) {

    if (user.id === currentUserId) {
        return (
            <div className="my-account-label">
                👤 내 계정
            </div>
        );
    }

    return (
        <>
            {user.role === 'pending' && (
                <button className="btn-action-base btn-approve" onClick={() => handleRoleChange(user.id, 'staff')}>✅ 승인</button>
            )}
            {user.role !== 'staff' && user.role !== 'pending' && (
                <button className="btn-action-base btn-demote" onClick={() => handleRoleChange(user.id, 'staff')}>⬇ 직원 강등</button>
            )}
            {user.role !== 'admin' && (
                <button className="btn-action-base btn-promote" onClick={() => handleRoleChange(user.id, 'admin')}>⬆ 관리자 승급</button>
            )}
            {user.role !== 'pending' && (
                <button className="btn-action-base btn-wait" onClick={() => handleRoleChange(user.id, 'pending')}>⏸ 대기로</button>
            )}

            {user.role !== 'admin' && (
                <button className="btn-action-base btn-delete" onClick={() => handleDeleteUser(user)}>🗑️ 삭제</button>
            )}
        </>
    );
}

function getRoleName(role) {
    if (role === 'admin') return '👑 관리자';
    if (role === 'staff') return '☕ 직원';
    return '⏳ 대기중';
}

function getRoleClass(role) {
    if (role === 'admin') return 'role-admin';
    if (role === 'staff') return 'role-staff';
    return 'role-pending';
}

export default UsersDashboard;