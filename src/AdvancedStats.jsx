import { useState, useEffect } from 'react';
import axios from 'axios';

function AdvancedStats({ onBack }) {
    const [stats, setStats] = useState({ itemStats: [], timeStats: [] });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // 데이터 가져오기
        axios.get('/api/admin/stats')
            .then(res => {
                setStats(res.data);
                setLoading(false);
            })
            .catch(err => alert("통계 로딩 실패"));
    }, []);

    // 최대값 계산 (그래프 비율용)
    const maxItemSales = Math.max(...stats.itemStats.map(i => i.total_sales), 1);
    const maxTimeSales = Math.max(...stats.timeStats.map(t => t.total_sales), 1);

    if (loading) return <div style={{padding:'50px', textAlign:'center'}}>데이터 분석 중... 📊</div>;

    return (
        <div style={{ padding: '30px', backgroundColor: '#f4f6f8', minHeight: '100vh' }}>
            {/* 상단 헤더 */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '30px' }}>
                <button onClick={onBack} style={backBtnStyle}>⬅ 뒤로가기</button>
                <h1 style={{ marginLeft: '20px', fontSize: '1.8rem', color: '#333' }}>📊 고급 매출 분석 (각종 그래프 추천 받아요!!)</h1>
            </div>

            <div style={gridContainer}>

                {/* 1. 품목별 판매 순위 */}
                <div style={cardStyle}>
                    <h2 style={cardTitle}>🍔 메뉴별 인기 순위</h2>
                    <div style={listStyle}>
                        {stats.itemStats.map((item, idx) => (
                            <div key={idx} style={rowStyle}>
                                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'5px' }}>
                                    <span style={{fontWeight:'bold'}}>{idx+1}. {item.menu_name}</span>
                                    <span style={{color:'black'}}>
                                        {Number(item.total_qty).toLocaleString()}잔 / {Number(item.total_sales).toLocaleString()}원
                                    </span>
                                </div>
                                {/* 막대 그래프 */}
                                <div style={{ width: '100%', backgroundColor: '#eee', borderRadius: '5px', height: '10px' }}>
                                    <div style={{
                                        width: `${(item.total_sales / maxItemSales) * 100}%`,
                                        backgroundColor: idx < 3 ? '#ff5722' : '#2196f3', // TOP 3는 주황색
                                        height: '100%', borderRadius: '5px',
                                        transition: 'width 1s ease-in-out'
                                    }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 2. 시간대별 매출 추이 */}
                <div style={cardStyle}>
                    <h2 style={cardTitle}>⏰ 시간대별 매출 추이</h2>
                    <div style={{ display: 'flex', alignItems: 'flex-end', height: '300px', gap: '10px', overflowX: 'auto', paddingBottom:'10px' }}>
                        {stats.timeStats.map((time, idx) => (
                            <div key={idx} style={{ display:'flex', flexDirection:'column', alignItems:'center', flex:1 }}>
                                <div style={{ fontSize:'0.8rem', fontWeight:'bold', color:'#4caf50', marginBottom:'5px' }}>
                                    {Number(time.total_sales).toLocaleString()}
                                </div>
                                {/* 세로 막대 그래프 */}
                                <div style={{
                                    width: '30px',
                                    height: `${(time.total_sales / maxTimeSales) * 200}px`, // 최대 200px 높이
                                    backgroundColor: '#4caf50',
                                    borderRadius: '5px 5px 0 0',
                                    transition: 'height 0.5s'
                                }} />
                                <div style={{ marginTop:'10px', fontWeight:'bold', color:'#555' }}>
                                    {time.hour}시
                                </div>
                            </div>
                        ))}
                        {stats.timeStats.length === 0 && <p style={{width:'100%', textAlign:'center'}}>데이터가 없습니다.</p>}
                    </div>
                </div>

            </div>
        </div>
    );
}

// 스타일
const backBtnStyle = { padding: '10px 20px', fontSize: '1rem', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight:'bold' };
const gridContainer = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' };
const cardStyle = { backgroundColor: 'white', padding: '25px', borderRadius: '15px', boxShadow: '0 4px 15px rgba(0,0,0,0.05)' };
const cardTitle = { borderBottom: '2px solid #eee', paddingBottom: '15px', marginBottom: '20px', color: '#333' };
const listStyle = { display: 'flex', flexDirection: 'column', gap: '20px' };
const rowStyle = { display: 'flex', flexDirection: 'column' };

export default AdvancedStats;