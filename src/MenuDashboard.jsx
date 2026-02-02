import { useState, useEffect } from 'react';
import axios from 'axios';

function MenuDashboard({ onBack }) {
    const [menuList, setMenuList] = useState([]);
    const [editingId, setEditingId] = useState(null); // 수정 중인 메뉴 ID

    // 입력 폼 상태 (추가/수정 공용)
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

    // --- [추가] ---
    const handleAdd = async (e) => {
        e.preventDefault();
        try {
            await axios.post('/api/menu', formData);
            alert("메뉴가 추가되었습니다.");
            setFormData({ name: '', price: '', type: 'coffee' }); // 초기화
            fetchMenu();
        } catch (err) {
            alert("추가 실패");
        }
    };

    // --- [삭제] ---
    const handleDelete = async (id) => {
        if (!window.confirm("정말 이 메뉴를 삭제하시겠습니까?")) return;
        try {
            await axios.delete(`/api/menu/${id}`);
            fetchMenu();
        } catch (err) {
            alert("삭제 실패");
        }
    };

    // --- [수정 모드 진입] ---
    const startEdit = (menu) => {
        setEditingId(menu.id);
        setFormData({ name: menu.name, price: menu.price, type: menu.type });
    };

    // --- [수정 저장] ---
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

    // --- [품절 토글] ---
    const toggleSoldOut = async (menu) => {
        try {
            // 0 -> 1, 1 -> 0 뒤집기
            const newVal = menu.is_soldout ? 0 : 1;
            await axios.patch(`/api/menu/${menu.id}`, { is_soldout: newVal });
            fetchMenu();
        } catch (err) {
            alert("상태 변경 실패");
        }
    };

    return (
        <div style={containerStyle}>
            <div style={headerStyle}>
                <div style={{display:'flex', alignItems:'center', gap:'15px'}}>
                    <button onClick={onBack} style={backBtnStyle}>⬅ 뒤로</button>
                    <h1 style={{margin:0}}>📋 메뉴 관리</h1>
                </div>
            </div>

            <div style={{display: 'flex', gap: '20px'}}>
                {/* 왼쪽: 메뉴 추가/수정 폼 */}
                <div style={formCardStyle}>
                    <h3 style={{marginTop:0}}>{editingId ? "✏️ 메뉴 수정" : "➕ 메뉴 추가"}</h3>
                    <form onSubmit={editingId ? (e) => {e.preventDefault(); handleUpdate();} : handleAdd} style={{display:'flex', flexDirection:'column', gap:'10px'}}>
                        <input
                            name="name"
                            placeholder="메뉴 이름 (예: 카페라떼)"
                            value={formData.name}
                            onChange={handleInputChange}
                            style={inputStyle}
                            required
                        />
                        <input
                            name="price"
                            type="number"
                            placeholder="가격 (예: 3000)"
                            value={formData.price}
                            onChange={handleInputChange}
                            style={inputStyle}
                            required
                        />
                        <select name="type" value={formData.type} onChange={handleInputChange} style={inputStyle}>
                            <option value="coffee">커피</option>
                            <option value="tea">티/에이드</option>
                            <option value="dessert">디저트</option>
                        </select>

                        <button type="submit" style={editingId ? updateBtnStyle : addBtnStyle}>
                            {editingId ? "수정 완료" : "추가하기"}
                        </button>

                        {editingId && (
                            <button type="button" onClick={() => {setEditingId(null); setFormData({name:'', price:'', type:'coffee'})}} style={cancelBtnStyle}>
                                취소
                            </button>
                        )}
                    </form>
                </div>

                {/* 오른쪽: 메뉴 리스트 */}
                <div style={{flex: 1, backgroundColor: 'white', padding: '20px', borderRadius: '15px', boxShadow: '0 4px 10px rgba(0,0,0,0.05)'}}>
                    <table style={{width: '100%', borderCollapse: 'collapse'}}>
                        <thead>
                        <tr style={{borderBottom: '2px solid #ddd', textAlign: 'left'}}>
                            <th style={thStyle}>이름</th>
                            <th style={thStyle}>가격</th>
                            <th style={thStyle}>분류</th>
                            <th style={thStyle}>품절여부</th>
                            <th style={thStyle}>관리</th>
                        </tr>
                        </thead>
                        <tbody>
                        {menuList.map(menu => (
                            <tr key={menu.id} style={{borderBottom: '1px solid #eee'}}>
                                <td style={tdStyle}>{menu.name}</td>
                                <td style={tdStyle}>{menu.price.toLocaleString()}원</td>
                                <td style={tdStyle}>
                                    <span style={typeBadgeStyle}>{menu.type}</span>
                                </td>
                                <td style={tdStyle}>
                                    <button
                                        onClick={() => toggleSoldOut(menu)}
                                        style={menu.is_soldout ? soldOutBtnStyle : saleBtnStyle}
                                    >
                                        {menu.is_soldout ? "🚫 품절중" : "🟢 판매중"}
                                    </button>
                                </td>
                                <td style={tdStyle}>
                                    <button onClick={() => startEdit(menu)} style={editBtnStyle}>수정</button>
                                    <button onClick={() => handleDelete(menu.id)} style={deleteBtnStyle}>삭제</button>
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

// 스타일
const containerStyle = { padding: '30px', backgroundColor: '#f4f6f8', minHeight: '100vh' };
const headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' };
const backBtnStyle = { padding: '8px 15px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' };
const formCardStyle = { width: '300px', backgroundColor: 'white', padding: '20px', borderRadius: '15px', boxShadow: '0 4px 10px rgba(0,0,0,0.05)', height: 'fit-content' };
const inputStyle = { padding: '10px', borderRadius: '5px', border: '1px solid #ddd', fontSize: '1rem' };
const thStyle = { padding: '12px', color: '#555' };
const tdStyle = { padding: '12px' };

const btnBase = { padding: '8px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontWeight: 'bold', width: '100%' };
const addBtnStyle = { ...btnBase, backgroundColor: '#007bff', color: 'white' };
const updateBtnStyle = { ...btnBase, backgroundColor: '#ff9800', color: 'white' };
const cancelBtnStyle = { ...btnBase, backgroundColor: '#9e9e9e', color: 'white', marginTop: '5px' };

const editBtnStyle = { padding: '5px 10px', backgroundColor: '#ff9800', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', marginRight: '5px' };
const deleteBtnStyle = { padding: '5px 10px', backgroundColor: '#ff5252', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' };
const typeBadgeStyle = { backgroundColor: '#e3f2fd', color: '#1565c0', padding: '3px 8px', borderRadius: '10px', fontSize: '0.8rem', fontWeight: 'bold' };

const saleBtnStyle = { padding: '5px 10px', backgroundColor: '#e8f5e9', color: '#2e7d32', border: '1px solid #2e7d32', borderRadius: '15px', cursor: 'pointer', fontWeight: 'bold' };
const soldOutBtnStyle = { padding: '5px 10px', backgroundColor: '#ffebee', color: '#c62828', border: '1px solid #c62828', borderRadius: '15px', cursor: 'pointer', fontWeight: 'bold' };

export default MenuDashboard;