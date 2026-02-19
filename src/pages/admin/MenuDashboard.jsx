import axios from 'axios';
import { useState, useEffect } from 'react';
import ThemeToggle from '../../components/ThemeToggle';

function MenuDashboard({ onBack }) {
    const [menuList, setMenuList] = useState([]);
    const [editingId, setEditingId] = useState(null);

    const [formData, setFormData] = useState({ name: '', price: '', type: 'coffee' });

    useEffect(() => {
        fetchMenu();
    }, []);

    const fetchMenu = async () => {
        try {
            const res = await axios.get('/api/menu');
            setMenuList(res.data);
        } catch (err) {
            alert("메뉴 불러오기 실패");
        }
    };

    const handleInputChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleAdd = async (e) => {
        e.preventDefault();
        try {
            await axios.post('/api/menu', formData);
            alert("메뉴가 추가되었습니다.");
            setFormData({ name: '', price: '', type: 'coffee' });
            fetchMenu();
        } catch (err) {
            alert("추가 실패");
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm("정말 이 메뉴를 삭제하시겠습니까?")) return;
        try {
            await axios.delete(`/api/menu/${id}`);
            fetchMenu();
        } catch (err) {
            alert("삭제 실패");
        }
    };

    const startEdit = (menu) => {
        setEditingId(menu.id);
        setFormData({ name: menu.name, price: menu.price, type: menu.type });
        // 모바일 환경에서 수정 버튼 누르면 화면 맨 위(폼 위치)로 스크롤 올려주기
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleUpdate = async () => {
        try {
            await axios.patch(`/api/menu/${editingId}`, formData);
            alert("수정되었습니다.");
            setEditingId(null);
            setFormData({ name: '', price: '', type: 'coffee' });
            fetchMenu();
        } catch (err) {
            alert("수정 실패");
        }
    };

    const toggleSoldOut = async (menu) => {
        try {
            const newVal = menu.is_soldout ? 0 : 1;
            await axios.patch(`/api/menu/${menu.id}`, { is_soldout: newVal });
            fetchMenu();
        } catch (err) {
            alert("상태 변경 실패");
        }
    };

    return (
        <div className="menu-container">
            <style>
                {`
                .menu-container {
                    padding: 20px;
                    background-color: var(--bg-color, #f4f6f8);
                    min-height: 100vh;
                    display: flex;
                    flex-direction: column;
                    box-sizing: border-box;
                    transition: background-color 0.3s ease;
                }
                
                .menu-header {
                    display: flex; justify-content: space-between; align-items: center; 
                    margin-bottom: 20px; flex-wrap: nowrap; gap: 15px;
                }
                .header-left { display: flex; align-items: center; gap: 15px; }
                .menu-title { margin: 0; color: var(--text-primary, #333); font-size: 1.8rem; white-space: nowrap; }
                
                /* 🌟 공통 뒤로가기 버튼 md 둥글기 적용 */
                .btn-back { padding: 10px 15px; background-color: #6c757d; color: white; border: none; border-radius: var(--radius-md); cursor: pointer; font-weight: bold; white-space: nowrap; }
                
                .theme-wrapper { display: flex; align-items: center; }

                .menu-content { display: flex; gap: 20px; align-items: flex-start; }
                
                /* 🌟 폼 영역 배경 카드에 lg 둥글기 적용 */
                .form-section {
                    width: 320px; flex-shrink: 0;
                    background-color: var(--card-bg, white);
                    padding: 20px; border-radius: var(--radius-lg);
                    box-shadow: 0 4px 15px rgba(0,0,0,0.05);
                    box-sizing: border-box;
                    border: 1px solid var(--border-color, transparent);
                    position: sticky; top: 20px; 
                }
                .form-title { margin-top: 0; margin-bottom: 15px; color: var(--text-primary, #333); }
                
                /* 🌟 입력창과 폼 버튼들에 md 둥글기 적용 */
                .menu-input {
                    padding: 12px; border-radius: var(--radius-md); border: 1px solid var(--border-color, #ddd); font-size: 1rem;
                    background-color: var(--bg-color, #f4f6f8); color: var(--text-primary, #333); width: 100%; box-sizing: border-box; margin-bottom: 10px;
                    -webkit-appearance: none;
                }
                .menu-input:focus { outline: none; border-color: #007bff; }
                
                .btn-submit { padding: 12px; border-radius: var(--radius-md); border: none; font-weight: bold; width: 100%; cursor: pointer; color: white; font-size: 1rem; transition: transform 0.1s;}
                .btn-submit:active { transform: scale(0.97); }
                .btn-add { background-color: #007bff; }
                .btn-update { background-color: #ff9800; }
                .btn-cancel { padding: 12px; border-radius: var(--radius-md); border: none; font-weight: bold; width: 100%; cursor: pointer; background-color: #6c757d; color: white; margin-top: 8px; font-size: 1rem;}

                /* 🌟 리스트 영역 배경 카드에 lg 둥글기 적용 */
                .list-section {
                    flex: 1; background-color: var(--card-bg, white); padding: 20px; border-radius: var(--radius-lg);
                    box-shadow: 0 4px 15px rgba(0,0,0,0.05); overflow: hidden; width: 100%; box-sizing: border-box;
                    border: 1px solid var(--border-color, transparent);
                }
                
                .menu-table-view { width: 100%; border-collapse: collapse; }
                .menu-table-view th { padding: 15px 10px; color: var(--text-secondary, #666); text-align: left; border-bottom: 2px solid var(--border-color, #ddd); white-space: nowrap; }
                .menu-table-view td { padding: 15px 10px; color: var(--text-primary, #333); border-bottom: 1px solid var(--border-color, #eee); }
                
                .menu-card-view { display: none; }

                /* 🌟 뱃지 및 작은 버튼들에 sm 둥글기 적용 */
                .badge-type { background-color: #e3f2fd; color: #1565c0; padding: 4px 10px; border-radius: var(--radius-md); font-size: 0.85rem; font-weight: bold; display: inline-block; }
                .btn-sale { padding: 6px 12px; background-color: #e8f5e9; color: #2e7d32; border: 1px solid #2e7d32; border-radius: var(--radius-sm); cursor: pointer; font-weight: bold; font-size: 0.85rem; transition: all 0.2s;}
                .btn-soldout { padding: 6px 12px; background-color: #ffebee; color: #c62828; border: 1px solid #c62828; border-radius: var(--radius-sm); cursor: pointer; font-weight: bold; font-size: 0.85rem; transition: all 0.2s;}
                
                .btn-action { padding: 6px 12px; border: none; border-radius: var(--radius-sm); cursor: pointer; font-weight: bold; font-size: 0.85rem; transition: background-color 0.2s; }
                .btn-edit { background-color: #ff9800; color: white; margin-right: 5px; }
                .btn-del { background-color: #dc3545; color: white; }

                [data-theme='dark'] .badge-type { background-color: rgba(21, 101, 192, 0.2); color: #64b5f6; }
                [data-theme='dark'] .btn-sale { background-color: rgba(46, 125, 50, 0.1); border-color: #4caf50; color: #81c784; }
                [data-theme='dark'] .btn-soldout { background-color: rgba(220, 53, 69, 0.1); border-color: #ff5252; color: #ff8a80; }
                [data-theme='dark'] .btn-edit { background-color: rgba(255, 152, 0, 0.2); color: #ffb74d; }
                [data-theme='dark'] .btn-edit:active { background-color: rgba(255, 152, 0, 0.3); }
                [data-theme='dark'] .btn-del { background-color: rgba(220, 53, 69, 0.2); color: #ff8a80; }
                [data-theme='dark'] .btn-del:active { background-color: rgba(220, 53, 69, 0.3); }


                @media (max-width: 768px) {
                    .menu-container { padding: 15px; }
                    
                    .menu-header { flex-direction: column; align-items: flex-start; gap: 12px; position: relative; }
                    .header-left { gap: 10px; padding-right: 40px; box-sizing: border-box; width: 100%; }
                    .menu-title { font-size: 1.5rem; }
                    .btn-back { padding: 8px 12px; font-size: 0.85rem; }
                    .theme-wrapper { position: absolute; top: 0; right: 0; height: 36px; display: flex; align-items: center; }

                    .menu-content { flex-direction: column; } 
                    .form-section { width: 100%; position: static; } 
                    .list-section { padding: 0; background-color: transparent; box-shadow: none; border: none; } 
                    
                    .menu-table-view { display: none; } 
                    .menu-card-view { display: flex; flex-direction: column; gap: 15px; } 
                    
                    /* 🌟 모바일 카드들도 모두 lg 둥글기로 통일 */
                    .menu-card {
                        background-color: var(--card-bg, white);
                        border-radius: var(--radius-lg); padding: 15px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.05);
                        display: flex; flex-direction: column; gap: 12px;
                        border: 1px solid var(--border-color, #eee);
                    }
                    .menu-card-header { display: flex; justify-content: space-between; align-items: center; }
                    .menu-card-title { font-size: 1.1rem; font-weight: bold; color: var(--text-primary, #333); }
                    .menu-card-price { font-size: 1.05rem; color: var(--text-primary, #555); margin-top: 5px; }
                    
                    .menu-card-actions { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-color, #eee); padding-top: 12px; margin-top: 5px; }
                }
                `}
            </style>

            <div className="menu-header">
                <div className="header-left">
                    <button onClick={onBack} className="btn-back">⬅ 뒤로</button>
                    <h1 className="menu-title">📋 메뉴 관리</h1>
                </div>
                <div className="theme-wrapper">
                    <ThemeToggle />
                </div>
            </div>

            <div className="menu-content">
                {/* 1. 왼쪽/상단: 메뉴 추가 및 수정 폼 */}
                <div className="form-section">
                    <h3 className="form-title">{editingId ? "✏️ 메뉴 수정" : "➕ 메뉴 추가"}</h3>
                    <form onSubmit={editingId ? (e) => {e.preventDefault(); handleUpdate();} : handleAdd}>
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

                        <button type="submit" className={`btn-submit ${editingId ? 'btn-update' : 'btn-add'}`}>
                            {editingId ? "수정 완료" : "추가하기"}
                        </button>

                        {editingId && (
                            <button type="button" onClick={() => {setEditingId(null); setFormData({name:'', price:'', type:'coffee'})}} className="btn-cancel">
                                취소
                            </button>
                        )}
                    </form>
                </div>

                {/* 2. 오른쪽/하단: 메뉴 리스트 */}
                <div className="list-section">
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
                        {menuList.map(menu => (
                            <tr key={menu.id}>
                                <td><strong>{menu.name}</strong></td>
                                <td>{menu.price.toLocaleString()}원</td>
                                <td><span className="badge-type">{menu.type}</span></td>
                                <td>
                                    <button onClick={() => toggleSoldOut(menu)} className={menu.is_soldout ? "btn-soldout" : "btn-sale"}>
                                        {menu.is_soldout ? "🚫 품절" : "🟢 판매중"}
                                    </button>
                                </td>
                                <td>
                                    <button onClick={() => startEdit(menu)} className="btn-action btn-edit">수정</button>
                                    <button onClick={() => handleDelete(menu.id)} className="btn-action btn-del">삭제</button>
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>

                    <div className="menu-card-view">
                        {menuList.map(menu => (
                            <div key={menu.id} className="menu-card">
                                <div>
                                    <div className="menu-card-header">
                                        <div className="menu-card-title">{menu.name}</div>
                                        <span className="badge-type">{menu.type}</span>
                                    </div>
                                    <div className="menu-card-price">{menu.price.toLocaleString()}원</div>
                                </div>

                                <div className="menu-card-actions">
                                    <button onClick={() => toggleSoldOut(menu)} className={menu.is_soldout ? "btn-soldout" : "btn-sale"}>
                                        {menu.is_soldout ? "🚫 품절중" : "🟢 판매중"}
                                    </button>
                                    <div>
                                        <button onClick={() => startEdit(menu)} className="btn-action btn-edit">수정</button>
                                        <button onClick={() => handleDelete(menu.id)} className="btn-action btn-del">삭제</button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                </div>
            </div>
        </div>
    );
}

export default MenuDashboard;