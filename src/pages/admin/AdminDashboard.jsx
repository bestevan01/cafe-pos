import { useState, useEffect } from 'react';
import axios from 'axios';
import MenuDashboard from './MenuDashboard';
import SalesDashboard from './SalesDashboard';
import SettlementDashboard from './SettlementDashboard';
import UsersDashboard from './UsersDashboard';
import ThemeToggle from '../../components/ThemeToggle'; // 🌟 테마 스위치 컴포넌트 불러오기

function AdminDashboard({ onLogout, onEditProfile }) {
    const [view, setView] = useState('home');
    const [users, setUsers] = useState([]);

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

    if (view === 'menu') return <MenuDashboard onBack={() => setView('home')}/>;
    if (view === 'sales') return <SalesDashboard onBack={() => setView('home')}/>;
    if (view === 'settlement') return <SettlementDashboard onBack={() => setView('home')}/>;
    if (view === 'users') return <UsersDashboard onBack={() => setView('home')}/>;

    if (view === 'home') {
        return (
            <div className="admin-container">

                <div className="top-right-header">
                    <ThemeToggle />
                    <button onClick={onEditProfile} className="btn-global btn-profile">
                        ⚙️ 내 정보
                    </button>
                    <button onClick={onLogout} className="btn-global btn-logout">
                        로그아웃
                    </button>
                </div>

                <style>
                    {`
                    /* 🌟 전체 컨테이너 (인라인 스타일 제거) */
                    .admin-container {
                        padding: 20px;
                        background-color: var(--bg-color, #f4f6f8);
                        min-height: 100vh;
                        display: flex;
                        flex-direction: column;
                        transition: background-color 0.3s ease;
                        box-sizing: border-box;
                        position: relative; 
                    }

                    /* 🌟 메인 컨텐츠 영역 */
                    .home-content { 
                        flex: 1; display: flex; flex-direction: column; 
                        align-items: center; justify-content: center; 
                    }

                    /* 🌟 우측 상단 글로벌 버튼 영역 */
                    .top-right-header {
                        position: absolute;
                        top: 15px;
                        right: 20px;
                        display: flex;
                        gap: 10px;
                        align-items: center;
                        z-index: 100;
                    }

                    /* 🌟 상단 공통 버튼 스타일 (둥글기 통일 핵심!) */
                    .btn-global {
                        padding: 8px 12px;
                        color: white;
                        border: none;
                        border-radius: var(--radius-md); /* ✅ 기존 20px, 8px 혼용을 12px 변수로 완벽 통일! */
                        font-weight: bold;
                        cursor: pointer;
                        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                        transition: transform 0.1s;
                        white-space: nowrap; /* 글자 줄바꿈 방지 */
                    }
                    .btn-global:active { transform: scale(0.95); }
                    .btn-profile { background-color: #495057; }
                    .btn-logout { background-color: #dc3545; }

                    .admin-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 25px; width: 100%; max-width: 1000px; margin-bottom: 50px; }
                    
                    /* 🌟 카드 스타일 */
                    .admin-card { 
                        background-color: var(--card-bg, white); 
                        border: 1px solid var(--border-color, transparent);
                        border-radius: var(--radius-lg); /* ✅ 기존 20px 하드코딩을 변수로 교체 */
                        padding: 35px 20px; 
                        box-shadow: 0 10px 25px rgba(0,0,0,0.05); 
                        cursor: pointer; display: flex; flex-direction: column; align-items: center; 
                        text-align: center; transition: transform 0.1s, box-shadow 0.1s, background-color 0.3s; 
                    }
                    .admin-card:active { transform: scale(0.96); box-shadow: 0 5px 15px rgba(0,0,0,0.05); }
                    .card-icon { font-size: 3.5rem; margin-bottom: 15px; }
                    .card-title { font-size: 1.3rem; font-weight: bold; color: var(--text-primary, #333); margin-bottom: 8px; }
                    .card-desc { font-size: 0.95rem; color: var(--text-secondary, #888); word-break: keep-all; }

                    /* 📱 모바일 화면 최적화 */
                    @media (max-width: 768px) {
                        /* 모바일 상단 버튼들 크기와 간격 다이어트 */
                        .top-right-header { top: 10px; right: 10px; gap: 8px; }
                        .btn-global { padding: 6px 10px; font-size: 0.85rem; }

                        .admin-grid { grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 20px; }
                        .admin-card { 
                            aspect-ratio: 1 / 1; justify-content: center; padding: 10px; 
                            border-radius: var(--radius-lg); /* ✅ 기존 18px 하드코딩을 변수로 교체 */
                        }
                        .card-icon { font-size: 2.5rem; margin-bottom: 8px; }
                        .card-title { font-size: 1.05rem; margin-bottom: 5px; word-break: keep-all; }
                        .card-desc { font-size: 0.75rem; margin: 0; }
                    }
                    `}
                </style>

                <div className="home-content">
                    <h1 style={{
                        fontSize: '2.2rem',
                        marginBottom: '30px',
                        color: 'var(--text-primary, #333)',
                        textAlign: 'center'
                    }}>
                        🛡️ 관리자 대시보드
                    </h1>

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

export default AdminDashboard;