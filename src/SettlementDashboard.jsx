import { useState, useEffect } from 'react';
import axios from 'axios';

function SettlementDashboard({ onBack }) {
    const [settlements, setSettlements] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchSettlements();
    }, []);

    const fetchSettlements = async () => {
        try {
            const res = await axios.get('/api/admin/settlements');
            setSettlements(res.data);
            setLoading(false);
        } catch (err) {
            alert("시재 기록 로딩 실패");
        }
    };

    return (
        <div style={containerStyle}>
            {/* 상단 헤더 */}
            <div style={headerStyle}>
                <div style={{display:'flex', alignItems:'center', gap:'15px'}}>
                    <button onClick={onBack} style={backBtnStyle}>⬅ 뒤로</button>
                    <h1 style={{margin:0, color:'#333'}}>💰 시재/정산 관리</h1>
                </div>
            </div>

            {/* 테이블 영역 */}
            <div style={cardStyle}>
                {loading ? <p>로딩 중...</p> : (
                    <div style={{overflowX:'auto'}}>
                        <table style={{width: '100%', borderCollapse: 'collapse'}}>
                            <thead>
                            <tr style={{borderBottom: '2px solid #ddd', textAlign: 'left'}}>
                                <th style={thStyle}>날짜</th>
                                <th style={thStyle}>상태</th>
                                <th style={thStyle}>오픈 시재</th>
                                <th style={thStyle}>+ 현금 매출</th>
                                <th style={thStyle}>= 전산 합계</th>
                                <th style={thStyle}>실제 마감액</th>
                                <th style={thStyle}>차액 (오차)</th>
                            </tr>
                            </thead>
                            <tbody>
                            {settlements.map(item => {
                                // 전산상 합계 계산 (오픈 + 매출)
                                const expected = item.opening_amount + item.sales_cash;
                                // 차액이 0이 아니면 빨간색 경고
                                const isDiff = item.difference !== 0;

                                return (
                                    <tr key={item.id} style={{borderBottom: '1px solid #eee'}}>
                                        <td style={tdStyle}>{new Date(item.date).toLocaleDateString()}</td>
                                        <td style={tdStyle}>
                                            {item.is_closed
                                                ? <span style={closedBadge}>마감완료</span>
                                                : <span style={openBadge}>영업중</span>}
                                        </td>
                                        <td style={tdStyle}>{item.opening_amount.toLocaleString()}원</td>
                                        <td style={tdStyle}>{item.sales_cash.toLocaleString()}원</td>
                                        <td style={{...tdStyle, fontWeight:'bold', color:'#007bff'}}>
                                            {expected.toLocaleString()}원
                                        </td>
                                        <td style={tdStyle}>
                                            {item.is_closed ? item.closing_amount.toLocaleString() + '원' : '-'}
                                        </td>
                                        <td style={tdStyle}>
                                            {item.is_closed ? (
                                                <span style={{
                                                    color: isDiff ? '#dc3545' : '#28a745',
                                                    fontWeight: 'bold',
                                                    backgroundColor: isDiff ? '#ffebee' : '#e8f5e9',
                                                    padding: '5px 10px', borderRadius: '15px'
                                                }}>
                                                        {item.difference > 0 ? '+' : ''}{item.difference.toLocaleString()}원
                                                    </span>
                                            ) : '-'}
                                        </td>
                                    </tr>
                                );
                            })}
                            {settlements.length === 0 && (
                                <tr><td colSpan="7" style={{padding:'20px', textAlign:'center'}}>기록이 없습니다.</td></tr>
                            )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

// 스타일 (MenuDashboard와 동일한 컨셉)
const containerStyle = { padding: '30px', backgroundColor: '#f4f6f8', minHeight: '100vh' };
const headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' };
const backBtnStyle = { padding: '8px 15px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' };
const cardStyle = { backgroundColor: 'white', padding: '20px', borderRadius: '15px', boxShadow: '0 4px 10px rgba(0,0,0,0.05)' };

// ✅ 테이블 스타일 (배경색 흰색 지정 완료)
const thStyle = {
    padding: '12px',
    color: '#333',
    textAlign: 'left',
    borderBottom: '2px solid #ddd',
    position: 'sticky', top: 0, backgroundColor: '#fff', zIndex: 10
};
const tdStyle = { padding: '12px', color: '#333' };

const openBadge = { backgroundColor: '#e3f2fd', color: '#1565c0', padding: '3px 8px', borderRadius: '10px', fontSize: '0.8rem', fontWeight: 'bold' };
const closedBadge = { backgroundColor: '#e8f5e9', color: '#2e7d32', padding: '3px 8px', borderRadius: '10px', fontSize: '0.8rem', fontWeight: 'bold' };

export default SettlementDashboard;