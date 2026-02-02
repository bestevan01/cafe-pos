import { useState, useEffect } from 'react';
import axios from 'axios';
import MenuDashboard from './MenuDashboard';
import SalesDashboard from './SalesDashboard';
import SettlementDashboard from './SettlementDashboard';

function AdminDashboard({ onLogout }) {
    // 1. 초기 화면을 'home'으로 설정 (목록이 아닌 선택 화면)
    const [view, setView] = useState('home'); // 'home' | 'users' | 'menu' | 'sales'
    const [users, setUsers] = useState([]);

    // --- [직원 관리 로직] ---
    useEffect(() => {
        if (view === 'users') {
            fetchUsers();
        }
    }, [view]);

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

    // --- [화면 전환 로직] ---
    if (view === 'menu') {
        return <MenuDashboard onBack={() => setView('home')} />;
    }
    if (view === 'sales') {
        return <SalesDashboard onBack={() => setView('home')} />;
    }
    if (view === 'settlement'){
        return <SettlementDashboard onBack={() => setView('home')} />;
    }

    // ✅ 2. 메인 선택 화면 (Home)
    if (view === 'home') {
        return (
            <div style={containerStyle}>
                <div style={homeContentStyle}>
                    <h1 style={{fontSize: '2.5rem', marginBottom: '40px', color: '#333'}}>🛡️ 관리자 대시보드</h1>

                    <div style={gridStyle}>
                        {/* 1. 매출 통계 버튼 */}
                        <button onClick={() => setView('sales')} style={bigCardStyle}>
                            <div style={iconStyle}>💸</div>
                            <div style={titleStyle}>매출 통계</div>
                            <div style={descStyle}>오늘/월간 매출 확인</div>
                        </button>

                        <button onClick={() => setView('settlement')} style={bigCardStyle}>
                            <div style={iconStyle}>💰</div>
                            <div style={titleStyle}>시재/정산 관리</div>
                            <div style={descStyle}>오픈/마감 현금 내역 확인</div>
                        </button>

                        {/* 2. 메뉴 관리 버튼 */}
                        <button onClick={() => setView('menu')} style={bigCardStyle}>
                            <div style={iconStyle}>📋</div>
                            <div style={titleStyle}>메뉴 관리</div>
                            <div style={descStyle}>메뉴 추가/수정/품절</div>
                        </button>

                        {/* 3. 직원 관리 버튼 */}
                        <button onClick={() => setView('users')} style={bigCardStyle}>
                            <div style={iconStyle}>👥</div>
                            <div style={titleStyle}>직원 관리</div>
                            <div style={descStyle}>가입 승인 및 권한 설정</div>
                        </button>
                    </div>

                    <button onClick={onLogout} style={logoutLinkStyle}>
                        로그아웃
                    </button>
                </div>
            </div>
        );
    }

    // ✅ 3. 직원 관리 화면 (기존 테이블 화면)
    return (
        <div style={containerStyle}>
            {/* 상단 헤더 */}
            <div style={headerStyle}>
                <div style={{display:'flex', alignItems:'center', gap:'15px'}}>
                    <button onClick={() => setView('home')} style={backBtnStyle}>⬅ 뒤로</button>
                    <h1 style={{margin:0}}>👥 직원 관리</h1>
                </div>
            </div>

            {/* 직원 관리 테이블 */}
            <div style={cardStyle}>
                <table style={{width: '100%', borderCollapse: 'collapse'}}>
                    <thead>
                    <tr style={{textAlign: 'left', borderBottom: '2px solid #ddd'}}>
                        <th style={thStyle}>이름</th>
                        <th style={thStyle}>아이디</th>
                        <th style={thStyle}>가입일</th>
                        <th style={thStyle}>현재 권한</th>
                        <th style={thStyle}>권한 변경</th>
                    </tr>
                    </thead>
                    <tbody>
                    {users.map(user => (
                        <tr key={user.id} style={{borderBottom: '1px solid #eee'}}>
                            <td style={tdStyle}>{user.name}</td>
                            <td style={tdStyle}>{user.username}</td>
                            <td style={tdStyle}>{new Date(user.created_at).toLocaleDateString()}</td>
                            <td style={tdStyle}>
                                    <span style={getRoleBadgeStyle(user.role)}>
                                        {getRoleName(user.role)}
                                    </span>
                            </td>
                            <td style={tdStyle}>
                                <div style={{display: 'flex', gap: '5px'}}>
                                    {user.role === 'pending' && (
                                        <button onClick={() => handleRoleChange(user.id, 'staff')} style={approveBtnStyle}>✅ 승인</button>
                                    )}
                                    {user.role !== 'staff' && user.role !== 'pending' && (
                                        <button onClick={() => handleRoleChange(user.id, 'staff')} style={normalBtnStyle}>⬇ 직원으로</button>
                                    )}
                                    {user.role !== 'admin' && (
                                        <button onClick={() => handleRoleChange(user.id, 'admin')} style={adminBtnStyle}>⬆ 관리자로</button>
                                    )}
                                    <button onClick={() => handleRoleChange(user.id, 'pending')} style={rejectBtnStyle}>🚫 차단</button>
                                </div>
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// --- 헬퍼 함수 ---
function getRoleName(role) {
    if (role === 'admin') return '👑 관리자';
    if (role === 'staff') return '☕ 직원';
    return '⏳ 대기중';
}

function getRoleBadgeStyle(role) {
    const base = { padding: '5px 10px', borderRadius: '15px', fontSize: '0.85rem', fontWeight: 'bold' };
    if (role === 'admin') return { ...base, backgroundColor: '#e3f2fd', color: '#1565c0' };
    if (role === 'staff') return { ...base, backgroundColor: '#e8f5e9', color: '#2e7d32' };
    return { ...base, backgroundColor: '#fff3e0', color: '#ef6c00' };
}

// --- 스타일 ---
const containerStyle = { padding: '30px', backgroundColor: '#f4f6f8', minHeight: '100vh', display: 'flex', flexDirection: 'column' };
const homeContentStyle = { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' };

const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)', // 3열 배치
    gap: '30px',
    width: '100%',
    maxWidth: '1000px',
    marginBottom: '50px'
};

const bigCardStyle = {
    backgroundColor: 'white',
    borderRadius: '20px',
    padding: '40px 20px',
    border: 'none',
    boxShadow: '0 10px 25px rgba(0,0,0,0.05)',
    cursor: 'pointer',
    transition: 'transform 0.2s, box-shadow 0.2s',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textDecoration: 'none'
};

const iconStyle = { fontSize: '4rem', marginBottom: '15px' };
const titleStyle = { fontSize: '1.5rem', fontWeight: 'bold', color: '#333', marginBottom: '10px' };
const descStyle = { fontSize: '1rem', color: '#888' };

const logoutLinkStyle = {
    marginTop: '20px',
    background: 'none',
    border: 'none',
    color: '#888',
    textDecoration: 'underline',
    cursor: 'pointer',
    fontSize: '1rem'
};

const headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' };
const backBtnStyle = { padding: '8px 15px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', marginRight: '10px' };

const cardStyle = { backgroundColor: 'white', padding: '30px', borderRadius: '15px', boxShadow: '0 4px 15px rgba(0,0,0,0.05)' };
const thStyle = { padding: '15px', color: '#666', fontWeight: 'bold' };
const tdStyle = { padding: '15px', color: '#333' };

// 버튼 스타일들
const roleBtnBase = { padding: '5px 10px', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' };
const approveBtnStyle = { ...roleBtnBase, backgroundColor: '#4caf50', color: 'white' };
const normalBtnStyle = { ...roleBtnBase, backgroundColor: '#9e9e9e', color: 'white' };
const adminBtnStyle = { ...roleBtnBase, backgroundColor: '#2196f3', color: 'white' };
const rejectBtnStyle = { ...roleBtnBase, backgroundColor: '#ff5252', color: 'white' };

export default AdminDashboard;