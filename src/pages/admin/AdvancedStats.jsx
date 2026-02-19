import { useState, useEffect } from 'react';
import axios from 'axios';
import ThemeToggle from '../../components/ThemeToggle';

function AdvancedStats({ onBack }) {
    const [stats, setStats] = useState({ itemStats: [], timeStats: [] });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        axios.get('/api/admin/stats')
            .then(res => {
                setStats(res.data);
                setLoading(false);
            })
            .catch(err => alert("통계 로딩 실패"));
    }, []);

    const maxItemSales = Math.max(...stats.itemStats.map(i => i.total_sales), 1);
    const maxTimeSales = Math.max(...stats.timeStats.map(t => t.total_sales), 1);

    if (loading) return <div style={{padding:'50px', textAlign:'center', color:'var(--text-secondary)'}}>데이터 분석 중... 📊</div>;

    return (
        <div className="adv-container">
            <style>
                {`
                .adv-container {
                    padding: 20px;
                    background-color: var(--bg-color, #f4f6f8);
                    min-height: 100vh;
                    box-sizing: border-box;
                    transition: background-color 0.3s ease;
                    width: 100%;
                    overflow-x: hidden;
                }
                
                .adv-header {
                    display: flex; align-items: center; justify-content: space-between; 
                    margin-bottom: 25px; flex-wrap: nowrap; gap: 15px;
                }
                .header-left { display: flex; align-items: center; gap: 15px; }
                .adv-title { margin: 0; font-size: 1.8rem; color: var(--text-primary, #333); white-space: nowrap; }
                
                /* 🌟 공통 뒤로가기 버튼 md 둥글기 적용 */
                .btn-back { padding: 10px 15px; background-color: #6c757d; color: white; border: none; border-radius: var(--radius-md); cursor: pointer; font-weight: bold; white-space: nowrap; }

                .adv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 25px; width: 100%; }
                
                /* 🌟 큰 차트 카드들에 lg 둥글기 적용 */
                .adv-card {
                    background-color: var(--card-bg, white);
                    padding: 25px;
                    border-radius: var(--radius-lg); 
                    box-shadow: 0 4px 15px rgba(0,0,0,0.05);
                    border: 1px solid var(--border-color, transparent);
                    transition: background-color 0.3s ease;
                    width: 100%; box-sizing: border-box;
                }
                .card-title {
                    margin-top: 0; border-bottom: 2px solid var(--border-color, #eee);
                    padding-bottom: 15px; margin-bottom: 20px;
                    color: var(--text-primary, #333); font-size: 1.4rem;
                }

                .item-list { display: flex; flex-direction: column; gap: 20px; width: 100%; }
                .item-row { display: flex; flex-direction: column; width: 100%; box-sizing: border-box; }
                .item-info { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 8px; gap: 10px; width: 100%; box-sizing: border-box; }
                .item-name { font-weight: bold; color: var(--text-primary, #333); word-break: keep-all; flex: 1; }
                .item-sales { color: var(--text-secondary, #666); font-size: 0.95rem; text-align: right; white-space: nowrap; font-weight: bold; }
                
                /* 🌟 차트 막대 배경과 채우기 요소는 기존 5px을 sm 변수로 교체 */
                .bar-bg { width: 100%; background-color: var(--border-color, #eee); border-radius: var(--radius-sm); height: 10px; overflow: hidden; box-sizing: border-box; }
                .bar-fill { height: 100%; border-radius: var(--radius-sm); transition: width 1s ease-in-out; }

                .desktop-time-chart { display: flex; align-items: flex-end; height: 300px; gap: 15px; overflow-x: auto; padding-bottom: 10px; scrollbar-width: thin; }
                .time-col { display: flex; flex-direction: column; align-items: center; min-width: 50px; flex: 1; }
                .time-val { font-size: 0.8rem; font-weight: bold; color: #4caf50; margin-bottom: 5px; text-align: center; }
                
                /* 🌟 세로 차트 막대는 위쪽만 둥글게 처리 (변수 조합) */
                .time-bar-vertical { 
                    width: 30px; background-color: #4caf50; 
                    border-radius: var(--radius-sm) var(--radius-sm) 0 0; 
                    transition: height 0.5s ease-out; 
                }
                .time-label { margin-top: 10px; font-weight: bold; color: var(--text-secondary, #555); font-size: 0.9rem; }

                .mobile-time-chart { display: none; }

                [data-theme='dark'] .time-val { color: #81c784; }
                [data-theme='dark'] .time-bar-vertical { background-color: #81c784; }
                
                @media (max-width: 768px) {
                    .adv-container { padding: 15px; }
                    
                    .adv-header { flex-direction: column; align-items: flex-start; gap: 12px; position: relative; }
                    .header-left { gap: 10px; padding-right: 40px; box-sizing: border-box; width: 100%; }
                    .adv-title { font-size: 1.5rem; }
                    .btn-back { padding: 8px 12px; font-size: 0.85rem; }
                    
                    .theme-wrapper { position: absolute; top: 0; right: 0; height: 36px; display: flex; align-items: center; }

                    .adv-grid { grid-template-columns: 1fr; gap: 15px; }
                    
                    /* 🌟 모바일에서도 카드는 lg 둥글기 유지 */
                    .adv-card { padding: 20px 15px; border-radius: var(--radius-lg); }
                    
                    .item-info { flex-direction: column; align-items: flex-start; gap: 4px; }
                    .item-sales { align-self: flex-end; font-size: 0.85rem; }

                    .desktop-time-chart { display: none; }
                    .mobile-time-chart { display: flex; flex-direction: column; gap: 20px; width: 100%; }
                }
                `}
            </style>

            <div className="adv-header">
                <div className="header-left">
                    <button onClick={onBack} className="btn-back">⬅ 뒤로가기</button>
                    <h1 className="adv-title">📊 고급 매출 분석</h1>
                </div>
                <div className="theme-wrapper">
                    <ThemeToggle />
                </div>
            </div>

            <div className="adv-grid">

                {/* 1. 품목별 판매 순위 (가로 차트 고정) */}
                <div className="adv-card">
                    <h2 className="card-title">🍔 메뉴별 인기 순위</h2>
                    <div className="item-list">
                        {stats.itemStats.map((item, idx) => (
                            <div key={idx} className="item-row">
                                <div className="item-info">
                                    <span className="item-name">{idx+1}. {item.menu_name}</span>
                                    <span className="item-sales">
                                        {Number(item.total_qty).toLocaleString()}잔 / {Number(item.total_sales).toLocaleString()}원
                                    </span>
                                </div>
                                <div className="bar-bg">
                                    <div className="bar-fill" style={{
                                        width: `${(item.total_sales / maxItemSales) * 100}%`,
                                        backgroundColor: idx < 3 ? '#ff7043' : '#42a5f5'
                                    }} />
                                </div>
                            </div>
                        ))}
                        {stats.itemStats.length === 0 && <p style={{color: 'var(--text-secondary)'}}>데이터가 없습니다.</p>}
                    </div>
                </div>

                {/* 2. 시간대별 매출 추이 (반응형 전환) */}
                <div className="adv-card">
                    <h2 className="card-title">⏰ 시간대별 매출 추이</h2>

                    {/* 💻 PC 화면일 때: 세로 차트 */}
                    <div className="desktop-time-chart">
                        {stats.timeStats.map((time, idx) => (
                            <div key={idx} className="time-col">
                                <div className="time-val">
                                    {Number(time.total_sales).toLocaleString()}
                                </div>
                                <div className="time-bar-vertical" style={{
                                    height: `${(time.total_sales / maxTimeSales) * 200}px` // 최대 200px
                                }} />
                                <div className="time-label">
                                    {time.hour}시
                                </div>
                            </div>
                        ))}
                        {stats.timeStats.length === 0 && <p style={{width:'100%', textAlign:'center', color: 'var(--text-secondary)'}}>데이터가 없습니다.</p>}
                    </div>

                    {/* 📱 모바일 화면일 때: 가로 차트 */}
                    <div className="mobile-time-chart">
                        {stats.timeStats.map((time, idx) => (
                            <div key={idx} className="item-row">
                                <div className="item-info">
                                    <span className="item-name">{time.hour}시</span>
                                    <span className="item-sales time-val">
                                        {Number(time.total_sales).toLocaleString()}원
                                    </span>
                                </div>
                                <div className="bar-bg">
                                    {/* 🌟 모바일의 가로 차트는 양쪽이 모두 둥글어야 하므로 인라인 강제 지정 추가 */}
                                    <div className="bar-fill time-bar-vertical" style={{
                                        width: `${(time.total_sales / maxTimeSales) * 100}%`,
                                        height: '100%',
                                        borderRadius: 'var(--radius-sm)'
                                    }} />
                                </div>
                            </div>
                        ))}
                        {stats.timeStats.length === 0 && <p style={{color: 'var(--text-secondary)'}}>데이터가 없습니다.</p>}
                    </div>
                </div>

            </div>
        </div>
    );
}

export default AdvancedStats;