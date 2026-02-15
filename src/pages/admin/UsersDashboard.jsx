// TODO: 다크 / 라이트 / 시스템 테마 제작 및 적용

import { useState, useEffect } from 'react';
import axios from 'axios';

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
        <div style={containerStyle}>
            {/* 반응형 CSS 삽입 */}
            <style>
                {`
                .users-container {
                    background-color: white;
                    border-radius: 15px;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.05);
                    overflow: hidden; /* 모서리 둥글게 깎기 위해 */
                }
                .users-table-view { display: table; width: 100%; border-collapse: collapse; }
                .users-card-view { display: none; } /* 기본은 카드 뷰 숨김 */

                /* 📱 모바일 화면 최적화 (768px 이하) */
                @media (max-width: 768px) {
                    .users-container { background-color: transparent; box-shadow: none; }
                    .users-table-view { display: none; } /* 모바일에서는 테이블 숨김 */
                    .users-card-view { display: flex; flex-direction: column; gap: 15px; } /* 카드 뷰 표시 */
                    
                    .user-card {
                        background-color: white;
                        border-radius: 15px;
                        padding: 20px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.05);
                        display: flex;
                        flex-direction: column;
                        gap: 10px;
                    }
                    .user-card-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee; padding-bottom: 10px; }
                    .user-name { font-size: 1.1rem; font-weight: bold; color: #333; }
                    .user-id { font-size: 0.85rem; color: #888; }
                    .user-card-body { display: flex; flex-direction: column; gap: 8px; font-size: 0.9rem; color: #555; }
                    .user-card-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; justify-content: flex-end; }
                    .action-btn { flex: 1; padding: 10px; text-align: center; border-radius: 8px; font-weight: bold; font-size: 0.9rem; border: none; cursor: pointer;}
                }
                `}
            </style>

            <div style={headerStyle}>
                <div style={{display:'flex', alignItems:'center', gap:'15px'}}>
                    <button onClick={onBack} style={backBtnStyle}>⬅ 뒤로</button>
                    <h1 style={{margin:0, color: '#333'}}>👥 직원 관리</h1>
                </div>
            </div>

            <div className="users-container">

                {/* 1. PC 뷰: 기존 테이블 형식 */}
                <table className="users-table-view">
                    <thead>
                    <tr style={{textAlign: 'left', borderBottom: '2px solid #ddd', backgroundColor: '#fafafa'}}>
                        <th style={thStyle}>이름</th>
                        <th style={thStyle}>아이디</th>
                        <th style={thStyle}>가입일</th>
                        <th style={thStyle}>현재 권한</th>
                        <th style={thStyle}>권한 변경</th>
                    </tr>
                    </thead>
                    <tbody>
                    {displayUsers.map(user => (
                        <tr key={user.id} style={{borderBottom: '1px solid #eee'}}>
                            <td style={tdStyle}><strong>{user.name}</strong></td>
                            <td style={tdStyle}>{user.username}</td>
                            <td style={tdStyle}>{new Date(user.created_at).toLocaleDateString()}</td>
                            <td style={tdStyle}>
                                    <span style={getRoleBadgeStyle(user.role)}>
                                        {getRoleName(user.role)}
                                    </span>
                            </td>
                            <td style={tdStyle}>
                                <div style={{display: 'flex', gap: '5px'}}>
                                    {RenderActionButtons(user, handleRoleChange, handleDeleteUser,false, currentUserId)}
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
                                <span style={getRoleBadgeStyle(user.role)}>{getRoleName(user.role)}</span>
                            </div>
                            <div className="user-card-body">
                                <div>📅 가입일: {new Date(user.created_at).toLocaleDateString()}</div>
                            </div>
                            <div className="user-card-actions">
                                {/* 모바일 카드용으로 버튼 렌더링 (클래스 부여) */}
                                {RenderActionButtons(user, handleRoleChange, handleDeleteUser,true, currentUserId)}
                            </div>
                        </div>
                    ))}
                </div>

            </div>
        </div>
    );
}

// 공통 버튼 렌더링 함수 (isMobile 파라미터로 모바일용 꽉 차는 버튼 스타일 지원)
function RenderActionButtons(user, handleRoleChange, handleDeleteUser, isMobile = false, currentUserId = null) {

    // 1. 자기 자신(내 계정)인 경우
    if (user.id === currentUserId) {
        return (
            <div style={{ padding: '8px', color: '#007bff', fontWeight: 'bold', fontSize: '0.9rem', width: '100%', textAlign: isMobile ? 'right' : 'left' }}>
                👤 내 계정
            </div>
        );
    }

    const btnClass = isMobile ? "action-btn" : "";
    const baseStyle = isMobile ? {} : { padding: '6px 10px', borderRadius: '5px', fontSize: '0.8rem', fontWeight: 'bold', border: 'none', cursor: 'pointer' };

    return (
        <>
            {/* 권한 변경 버튼들 */}
            {user.role === 'pending' && (
                <button className={btnClass} onClick={() => handleRoleChange(user.id, 'staff')} style={{...baseStyle, backgroundColor: '#4caf50', color: 'white'}}>✅ 승인</button>
            )}
            {user.role !== 'staff' && user.role !== 'pending' && (
                <button className={btnClass} onClick={() => handleRoleChange(user.id, 'staff')} style={{...baseStyle, backgroundColor: '#9e9e9e', color: 'white'}}>⬇ 직원 강등</button>
            )}
            {user.role !== 'admin' && (
                <button className={btnClass} onClick={() => handleRoleChange(user.id, 'admin')} style={{...baseStyle, backgroundColor: '#2196f3', color: 'white'}}>⬆ 관리자 승급</button>
            )}
            {user.role !== 'pending' && (
                <button className={btnClass} onClick={() => handleRoleChange(user.id, 'pending')} style={{...baseStyle, backgroundColor: '#ff9800', color: 'white'}}>⏸ 대기로</button>
            )}

            {/* 🗑️ 삭제 버튼: 'admin'이 아닌 계정에만 렌더링! */}
            {user.role !== 'admin' && (
                <button
                    className={btnClass}
                    onClick={() => handleDeleteUser(user)}
                    style={{...baseStyle, backgroundColor: '#d32f2f', color: 'white'}}
                >
                    🗑️ 삭제
                </button>
            )}
        </>
    );
}

// 헬퍼 함수
function getRoleName(role) {
    if (role === 'admin') return '👑 관리자';
    if (role === 'staff') return '☕ 직원';
    return '⏳ 대기중';
}

function getRoleBadgeStyle(role) {
    const base = { padding: '5px 10px', borderRadius: '15px', fontSize: '0.8rem', fontWeight: 'bold', display: 'inline-block' };
    if (role === 'admin') return { ...base, backgroundColor: '#e3f2fd', color: '#1565c0' };
    if (role === 'staff') return { ...base, backgroundColor: '#e8f5e9', color: '#2e7d32' };
    return { ...base, backgroundColor: '#fff3e0', color: '#ef6c00' };
}

// 스타일
const containerStyle = { padding: '20px', backgroundColor: '#f4f6f8', minHeight: '100vh', display: 'flex', flexDirection: 'column' };
const headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' };
const backBtnStyle = { padding: '10px 15px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' };
const thStyle = { padding: '15px', color: '#666', fontWeight: 'bold', whiteSpace: 'nowrap' };
const tdStyle = { padding: '15px', color: '#333', whiteSpace: 'nowrap' };

export default UsersDashboard;