// TODO: 다크 / 라이트 / 시스템 테마 제작 및 적용

import { useState, useEffect } from 'react';
import axios from 'axios';
import MenuDashboard from './MenuDashboard';
import SalesDashboard from './SalesDashboard';
import SettlementDashboard from './SettlementDashboard';
import UsersDashboard from './UsersDashboard';

function AdminDashboard({ onLogout, onEditProfile }) {
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
    if (view === 'settlement') {
        return <SettlementDashboard onBack={() => setView('home')} />;
    }
    if (view === 'users'){
        return <UsersDashboard onBack={() => setView('home')} />;
    }

    // ✅ 2. 메인 선택 화면 (Home)
    if (view === 'home') {
        return (
            <div style={containerStyle}>

                <div style={topRightHeaderStyle}>
                    <button onClick={onEditProfile} style={profileBtnStyle}>
                        ⚙️ 내 정보
                    </button>
                    <button onClick={onLogout} style={logoutBtnStyle}>
                        로그아웃
                    </button>
                </div>

                <style>
                    {`
                    .admin-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 25px; width: 100%; max-width: 1000px; margin-bottom: 50px; }
                    .admin-card { background-color: white; border-radius: 20px; padding: 35px 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); cursor: pointer; display: flex; flex-direction: column; align-items: center; text-align: center; border: none; transition: transform 0.1s, box-shadow 0.1s; }
                    .admin-card:active { transform: scale(0.96); box-shadow: 0 5px 15px rgba(0,0,0,0.05); }
                    .card-icon { font-size: 3.5rem; margin-bottom: 15px; }
                    .card-title { font-size: 1.3rem; font-weight: bold; color: #333; margin-bottom: 8px; }
                    .card-desc { font-size: 0.95rem; color: #888; word-break: keep-all; }

                    @media (max-width: 768px) {
                        .admin-grid { grid-template-columns: repeat(2, 1fr); gap: 15px; }
                        .admin-card { aspect-ratio: 1 / 1; justify-content: center; padding: 10px; border-radius: 18px; }
                        .card-icon { font-size: 2.5rem; margin-bottom: 8px; }
                        .card-title { font-size: 1.05rem; margin-bottom: 5px; word-break: keep-all; }
                        .card-desc { font-size: 0.75rem; margin: 0; }
                    }
                    `}
                </style>

                <div style={homeContentStyle}>
                    <h1 style={{fontSize: '2.2rem', marginBottom: '30px', color: '#333'}}>🛡️ 관리자 대시보드</h1>

                    <div className="admin-grid">
                        <button onClick={() => setView('sales')} className="admin-card">
                            <div className="card-icon">💸</div>
                            <div className="card-title">매출 통계</div>
                            <div className="card-desc">오늘/월간 매출 확인</div>
                        </button>
                        <button onClick={() => setView('settlement')} className="admin-card">
                            <div className="card-icon">💰</div>
                            <div className="card-title">시재/정산</div>
                            <div className="card-desc">오픈/마감 내역</div>
                        </button>
                        <button onClick={() => setView('menu')} className="admin-card">
                            <div className="card-icon">📋</div>
                            <div className="card-title">메뉴 관리</div>
                            <div className="card-desc">메뉴 추가/품절 변경</div>
                        </button>
                        <button onClick={() => setView('users')} className="admin-card">
                            <div className="card-icon">👥</div>
                            <div className="card-title">직원 관리</div>
                            <div className="card-desc">가입 승인 및 권한 설정</div>
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}

// --- 스타일 ---
const containerStyle = { padding: '20px', backgroundColor: '#f4f6f8', minHeight: '100vh', display: 'flex', flexDirection: 'column' };
const homeContentStyle = { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' };

const logoutLinkStyle = {
    marginTop: '20px',
    background: 'none',
    border: 'none',
    color: '#888',
    textDecoration: 'underline',
    cursor: 'pointer',
    fontSize: '1rem'
};

const topRightHeaderStyle = {
    position: 'absolute',
    top: '15px',
    right: '20px',
    display: 'flex',
    gap: '10px',
    zIndex: 100
};

const profileBtnStyle = {
    padding: '8px 12px',
    backgroundColor: '#495057',
    color: 'white',
    border: 'none',
    borderRadius: '20px',
    fontWeight: 'bold',
    cursor: 'pointer',
    boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
};

const logoutBtnStyle = {
    padding: '8px 12px',
    backgroundColor: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: 'bold',
    boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
}

export default AdminDashboard;