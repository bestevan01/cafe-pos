import axios from 'axios';
import { useState, useEffect, useCallback } from 'react';
import ThemeToggle from '../../components/ThemeToggle';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { useNotification } from '../../hooks/useNotification';

/**
 * @param {object} props
 * @param {() => void} props.onBack
 */
function MenuDashboard({ onBack }) {
    const { notify, confirm } = useNotification();
    // ---------------------------------------------------------
    // [1] 상태 관리 (State)
    // ---------------------------------------------------------
    const [menuList, setMenuList] = useState(/** @type {import('../../types').Menu[]} */ ([]));
    const [editingId, setEditingId] = useState(/** @type {string|null} */ (null));
    const [formData, setFormData] = useState({ name: '', price: '', type: 'coffee' });

    // API 권한 토큰
    const getAuthHeader = () => ({
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });

    // ---------------------------------------------------------
    // [2] API 통신 로직
    // ---------------------------------------------------------
    const fetchMenu = useCallback(async () => {
        try {
            const res = await axios.get('/api/menu', getAuthHeader());
            setMenuList(res.data);
        } catch {
            notify('메뉴 불러오기 실패', { icon: '⚠️' });
        }
    }, [notify]);

    useEffect(() => {
        // fetchMenu는 useCallback으로 메모이즈된 비동기 함수라 setState가 await 이후에만 일어남(effect 본문에서 동기 호출 아님) — 규칙 오탐.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void fetchMenu();
    }, [fetchMenu]);

    /** @param {import('react').FormEvent<HTMLFormElement>} e */
    const handleAdd = async (e) => {
        e.preventDefault();
        try {
            await axios.post('/api/menu', formData, getAuthHeader());
            notify('메뉴가 추가되었습니다.', { icon: '✅' });
            setFormData({ name: '', price: '', type: 'coffee' });
            await fetchMenu();
        } catch {
            notify('추가 실패', { icon: '⚠️' });
        }
    };

    /** @param {string} id */
    const handleDelete = async (id) => {
        if (
            !(await confirm('정말 이 메뉴를 삭제하시겠습니까?', {
                title: '메뉴 삭제',
                confirmText: '삭제',
                danger: true,
            }))
        )
            return;
        try {
            await axios.delete(`/api/menu/${id}`, getAuthHeader());
            await fetchMenu();
        } catch {
            notify('삭제 실패', { icon: '⚠️' });
        }
    };

    const handleUpdate = async () => {
        try {
            await axios.patch(`/api/menu/${editingId}`, formData, getAuthHeader());
            notify('수정되었습니다.', { icon: '✅' });
            setEditingId(null);
            setFormData({ name: '', price: '', type: 'coffee' });
            await fetchMenu();
        } catch {
            notify('수정 실패', { icon: '⚠️' });
        }
    };

    /** @param {import('../../types').Menu} menu */
    const toggleSoldOut = async (menu) => {
        try {
            const newVal = menu.is_soldout ? 0 : 1;
            await axios.patch(`/api/menu/${menu.id}`, { is_soldout: newVal }, getAuthHeader());
            await fetchMenu();
        } catch {
            notify('상태 변경 실패', { icon: '⚠️' });
        }
    };

    // ---------------------------------------------------------
    // [3] 이벤트 핸들러 및 헬퍼
    // ---------------------------------------------------------
    /** @param {any} e */
    const handleInputChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    /** @param {import('../../types').Menu} menu */
    const startEdit = (menu) => {
        setEditingId(menu.id);
        setFormData({ name: menu.name, price: String(menu.price), type: menu.type });
        // 모바일 환경 UX: 수정 버튼 클릭 시 폼 위치로 스크롤 이동
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // ---------------------------------------------------------
    // [4] 렌더링 (Render)
    // ---------------------------------------------------------
    return (
        <div className="menu-container">
            <style>
                {`
                /* 전체 레이아웃 */
                .menu-container { padding: 20px; background-color: var(--bg-color, #f4f6f8); min-height: 100dvh; display: flex; flex-direction: column; box-sizing: border-box; transition: background-color 0.3s ease; }
                
                /* 헤더 영역 */
                .menu-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: nowrap; gap: 15px; }
                .header-left { display: flex; align-items: center; gap: 15px; }
                .menu-title { margin: 0; color: var(--text-primary, #333); font-size: 1.8rem; white-space: nowrap; }
                .theme-wrapper { display: flex; align-items: center; }

                /* 컨텐츠 영역 (폼 + 리스트) */
                .menu-content { display: flex; gap: 20px; align-items: flex-start; }
                
                /* 입력 폼 섹션 */
                .form-section { width: 320px; flex-shrink: 0; box-sizing: border-box; position: sticky; top: 20px; } /* 카드 외형은 공용 <Card>가 담당 */
                .form-title { margin-top: 0; margin-bottom: 15px; color: var(--text-primary, #333); }
                .menu-input { padding: 12px; border-radius: var(--radius-md); border: 1px solid var(--border-color, #ddd); font-size: 1rem; background-color: var(--bg-color, #f4f6f8); color: var(--text-primary, #333); width: 100%; box-sizing: border-box; margin-bottom: 10px; -webkit-appearance: none; }
                .menu-input:focus { outline: none; border-color: var(--accent); }
                

                /* 리스트 섹션 */
                .list-section { flex: 1; overflow: hidden; width: 100%; box-sizing: border-box; } /* 카드 외형은 공용 <Card>가 담당 */
                
                /* PC 테이블 뷰 */
                .menu-table-view { width: 100%; border-collapse: collapse; }
                .menu-table-view th { padding: 15px 10px; color: var(--text-secondary, #666); text-align: left; border-bottom: 2px solid var(--border-color, #ddd); white-space: nowrap; }
                .menu-table-view td { padding: 15px 10px; color: var(--text-primary, #333); border-bottom: 1px solid var(--border-color, #eee); }
                .menu-card-view { display: none; }

                /* 버튼 및 뱃지 스타일 */
                .badge-type { background-color: var(--accent-bg); color: #1565c0; padding: 4px 10px; border-radius: var(--radius-md); font-size: 0.85rem; font-weight: bold; display: inline-block; }
                .btn-sale { padding: 6px 12px; background-color: var(--success-bg); color: var(--success); border: 1px solid var(--success); border-radius: var(--radius-sm); cursor: pointer; font-weight: bold; font-size: 0.85rem; transition: all 0.2s; }
                .btn-soldout { padding: 6px 12px; background-color: var(--danger-bg); color: #c62828; border: 1px solid #c62828; border-radius: var(--radius-sm); cursor: pointer; font-weight: bold; font-size: 0.85rem; transition: all 0.2s; }
                .btn-action { padding: 6px 12px; border: none; border-radius: var(--radius-sm); cursor: pointer; font-weight: bold; font-size: 0.85rem; transition: background-color 0.2s; }
                .btn-edit { background-color: var(--warning); color: white; margin-right: 5px; }
                .btn-del { background-color: var(--danger); color: white; }

                /* 다크모드 오버라이드 */
                [data-theme='dark'] .badge-type { background-color: rgba(21, 101, 192, 0.2); color: #64b5f6; }
                [data-theme='dark'] .btn-sale { background-color: rgba(46, 125, 50, 0.1); border-color: #4caf50; color: #81c784; }
                [data-theme='dark'] .btn-soldout { background-color: rgba(220, 53, 69, 0.1); border-color: #ff5252; color: #ff8a80; }
                [data-theme='dark'] .btn-edit { background-color: rgba(255, 152, 0, 0.2); color: #ffb74d; }
                [data-theme='dark'] .btn-del { background-color: rgba(220, 53, 69, 0.2); color: #ff8a80; }

                /* 모바일 반응형 */
                @media (max-width: 768px) {
                    .menu-container { padding: 15px; }
                    .menu-header { flex-direction: column; align-items: flex-start; gap: 12px; position: relative; }
                    .header-left { width: 100%; }
                    .theme-wrapper { position: absolute; top: 0; right: 0; }
                    
                    .menu-content { flex-direction: column; } 
                    .form-section { width: 100%; position: static; } 
                    .list-section { padding: 0; background-color: transparent; box-shadow: none; border: none; } 
                    
                    .menu-table-view { display: none; } 
                    .menu-card-view { display: flex; flex-direction: column; gap: 15px; } 
                    
                    /* 모바일 카드 뷰 */
                    .menu-card { background-color: var(--card-bg, white); border-radius: var(--radius-lg); padding: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); display: flex; flex-direction: column; gap: 12px; border: 1px solid var(--border-color, #eee); }
                    .menu-card-header { display: flex; justify-content: space-between; align-items: center; }
                    .menu-card-title { font-size: 1.1rem; font-weight: bold; color: var(--text-primary, #333); }
                    .menu-card-price { font-size: 1.05rem; color: var(--text-primary, #555); margin-top: 5px; }
                    .menu-card-actions { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-color, #eee); padding-top: 12px; margin-top: 5px; }
                }
                `}
            </style>

            {/* 헤더 */}
            <div className="menu-header">
                <div className="header-left">
                    <Button variant="neutral" icon="⬅" onClick={onBack}>
                        뒤로
                    </Button>
                    <h1 className="menu-title">📋 메뉴 관리</h1>
                </div>
                <div className="theme-wrapper">
                    <ThemeToggle />
                </div>
            </div>

            <div className="menu-content">
                {/* 1. 입력 폼 섹션 (추가/수정) */}
                <Card className="form-section">
                    <h3 className="form-title">{editingId ? '✏️ 메뉴 수정' : '➕ 메뉴 추가'}</h3>
                    <form
                        onSubmit={
                            editingId
                                ? (e) => {
                                      e.preventDefault();
                                      void handleUpdate();
                                  }
                                : handleAdd
                        }
                    >
                        <input
                            name="name"
                            placeholder="메뉴 이름 (예: 카페라떼)"
                            value={formData.name}
                            onChange={handleInputChange}
                            className="menu-input"
                            required
                        />
                        <input
                            name="price"
                            type="number"
                            placeholder="가격 (예: 3000)"
                            value={formData.price}
                            onChange={handleInputChange}
                            className="menu-input"
                            required
                        />
                        <select name="type" value={formData.type} onChange={handleInputChange} className="menu-input">
                            <option value="coffee">커피</option>
                            <option value="tea">티/에이드</option>
                            <option value="dessert">디저트</option>
                        </select>

                        <Button type="submit" full variant={editingId ? 'warning' : 'primary'}>
                            {editingId ? '수정 완료' : '추가하기'}
                        </Button>
                        {editingId && (
                            <Button
                                type="button"
                                variant="neutral"
                                full
                                style={{ marginTop: 8 }}
                                onClick={() => {
                                    setEditingId(null);
                                    setFormData({ name: '', price: '', type: 'coffee' });
                                }}
                            >
                                취소
                            </Button>
                        )}
                    </form>
                </Card>

                {/* 2. 메뉴 리스트 섹션 */}
                <Card className="list-section">
                    {/* PC 테이블 뷰 */}
                    <table className="menu-table-view">
                        <thead>
                            <tr>
                                <th>이름</th>
                                <th>가격</th>
                                <th>분류</th>
                                <th>상태 변경</th>
                                <th>관리</th>
                            </tr>
                        </thead>
                        <tbody>
                            {menuList.map((menu) => (
                                <tr key={menu.id}>
                                    <td>
                                        <strong>{menu.name}</strong>
                                    </td>
                                    <td>{menu.price.toLocaleString()}원</td>
                                    <td>
                                        <span className="badge-type">{menu.type}</span>
                                    </td>
                                    <td>
                                        <button
                                            onClick={() => toggleSoldOut(menu)}
                                            className={menu.is_soldout ? 'btn-soldout' : 'btn-sale'}
                                        >
                                            {menu.is_soldout ? '🚫 품절' : '🟢 판매중'}
                                        </button>
                                    </td>
                                    <td>
                                        <button onClick={() => startEdit(menu)} className="btn-action btn-edit">
                                            수정
                                        </button>
                                        <button onClick={() => handleDelete(menu.id)} className="btn-action btn-del">
                                            삭제
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {/* 모바일 카드 뷰 */}
                    <div className="menu-card-view">
                        {menuList.map((menu) => (
                            <div key={menu.id} className="menu-card">
                                <div>
                                    <div className="menu-card-header">
                                        <div className="menu-card-title">{menu.name}</div>
                                        <span className="badge-type">{menu.type}</span>
                                    </div>
                                    <div className="menu-card-price">{menu.price.toLocaleString()}원</div>
                                </div>
                                <div className="menu-card-actions">
                                    <button
                                        onClick={() => toggleSoldOut(menu)}
                                        className={menu.is_soldout ? 'btn-soldout' : 'btn-sale'}
                                    >
                                        {menu.is_soldout ? '🚫 품절중' : '🟢 판매중'}
                                    </button>
                                    <div>
                                        <button onClick={() => startEdit(menu)} className="btn-action btn-edit">
                                            수정
                                        </button>
                                        <button onClick={() => handleDelete(menu.id)} className="btn-action btn-del">
                                            삭제
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            </div>
        </div>
    );
}

export default MenuDashboard;
