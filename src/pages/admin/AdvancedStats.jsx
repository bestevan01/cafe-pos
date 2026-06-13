import {useState, useEffect} from 'react';
import axios from 'axios';
import ThemeToggle from '../../components/ThemeToggle';
import {useNotification} from '../../hooks/useNotification';

function AdvancedStats({onBack}) {
    const {notify} = useNotification();
    const [stats, setStats] = useState({itemStats: [], timeStats: []});
    const [loading, setLoading] = useState(true);

    // API 권한 토큰
    const getAuthHeader = () => ({
        headers: {Authorization: `Bearer ${localStorage.getItem('token')}`}
    });

    // ---------------------------------------------------------
    // [1] 데이터 로딩
    // ---------------------------------------------------------
    useEffect(() => {
        axios.get('/api/admin/stats', getAuthHeader())
            .then(res => {
                setStats(res.data);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                notify("통계 로딩 실패", {icon: '⚠️'});
                setLoading(false);
            });
    }, [notify]);

    // ---------------------------------------------------------
    // [2] 차트 스케일 계산 (최대값 기준)
    // ---------------------------------------------------------
    const maxItemSales = Math.max(...stats.itemStats.map(i => Number(i['total_sales'])), 1);
    const maxTimeSales = Math.max(...stats.timeStats.map(t => Number(t['total_sales'])), 1);

    if (loading) return <div style={{padding: '50px', textAlign: 'center', color: 'var(--text-secondary)'}}>데이터 분석 중...
        📊</div>;

    // ---------------------------------------------------------
    // [3] 렌더링 (Render)
    // ---------------------------------------------------------
    return (
        <div className="main-container">
            <style>
                {`
                .main-container {
                    padding: 20px; background-color: var(--bg-color, #f4f6f8); min-height: 100vh;
                    box-sizing: border-box; transition: background-color 0.3s ease; width: 100%; overflow-x: hidden;
                }
                .main-header {
                    display: flex; align-items: center; justify-content: space-between; 
                    margin-bottom: 25px; gap: 15px;
                }
                .header-left { display: flex; align-items: center; gap: 15px; }
                .main-title { margin: 0; font-size: 1.8rem; color: var(--text-primary, #333); white-space: nowrap; }
                .btn-back { padding: 10px 15px; background-color: #6c757d; color: white; border: none; border-radius: var(--radius-md); cursor: pointer; font-weight: bold; white-space: nowrap; }

                .main-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 25px; width: 100%; }
                
                .main-card {
                    background-color: var(--card-bg, white); padding: 25px; border-radius: var(--radius-lg); 
                    box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid var(--border-color, transparent);
                    transition: background-color 0.3s ease; width: 100%; box-sizing: border-box;
                }
                .card-title {
                    margin-top: 0; border-bottom: 2px solid var(--border-color, #eee);
                    padding-bottom: 15px; margin-bottom: 20px; color: var(--text-primary, #333); font-size: 1.4rem;
                }

                /* 공통: 아이템 리스트 스타일 */
                .item-list { display: flex; flex-direction: column; gap: 20px; width: 100%; }
                .item-row { display: flex; flex-direction: column; width: 100%; box-sizing: border-box; }
                .item-info { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 8px; gap: 10px; width: 100%; }
                .item-name { font-weight: bold; color: var(--text-primary, #333); word-break: keep-all; flex: 1; }
                .item-sales { color: var(--text-secondary, #666); font-size: 0.95rem; text-align: right; white-space: nowrap; font-weight: bold; }
                
                /* 차트 막대 스타일 */
                .bar-bg { width: 100%; background-color: var(--border-color, #eee); border-radius: var(--radius-sm); height: 10px; overflow: hidden; }
                .bar-fill { height: 100%; border-radius: var(--radius-sm); transition: width 1s ease-in-out; }

                /* PC용 세로 차트 */
                .desktop-time-chart { display: flex; align-items: flex-end; height: 300px; gap: 15px; overflow-x: auto; padding-bottom: 10px; }
                .time-col { display: flex; flex-direction: column; align-items: center; min-width: 50px; flex: 1; }
                .time-val { font-size: 0.8rem; font-weight: bold; color: #4caf50; margin-bottom: 5px; text-align: center; }
                .time-bar-vertical { 
                    width: 30px; background-color: #4caf50; 
                    border-radius: var(--radius-sm) var(--radius-sm) 0 0; transition: height 0.5s ease-out; 
                }
                .time-label { margin-top: 10px; font-weight: bold; color: var(--text-secondary, #555); font-size: 0.9rem; }

                .mobile-time-chart { display: none; } /* 모바일용 가로 차트 숨김 (기본) */

                [data-theme='dark'] .time-val { color: #81c784; }
                [data-theme='dark'] .time-bar-vertical { background-color: #81c784; }
                
                /* 모바일 반응형 */
                @media (max-width: 768px) {
                    .main-container { padding: 15px; }
                    .main-header { flex-direction: column; align-items: flex-start; gap: 12px; position: relative; }
                    .header-left { width: 100%; }
                    .theme-wrapper { position: absolute; top: 0; right: 0; }
                    
                    .main-grid { grid-template-columns: 1fr; }
                    .desktop-time-chart { display: none; } /* PC 차트 숨김 */
                    .mobile-time-chart { display: flex; flex-direction: column; gap: 20px; width: 100%; } /* 모바일 차트 표시 */
                }
                `}
            </style>

            <div className="main-header">
                <div className="header-left">
                    <button onClick={onBack} className="btn-back">⬅ 뒤로가기</button>
                    <h1 className="main-title">📊 고급 매출 분석</h1>
                </div>
                <div className="theme-wrapper">
                    <ThemeToggle/>
                </div>
            </div>

            <div className="main-grid">
                {/* 1. 메뉴별 판매 순위 (가로 막대) */}
                <div className="main-card">
                    <h2 className="card-title">🍔 메뉴별 인기 순위</h2>
                    <div className="item-list">
                        {stats.itemStats.length === 0 ? <p style={{color: 'var(--text-secondary)'}}>데이터가
                            없습니다.</p> : stats.itemStats.map((item, idx) => (
                            <div key={idx} className="item-row">
                                <div className="item-info">
                                    <span className="item-name">{idx + 1}. {item.menu_name}</span>
                                    <span
                                        className="item-sales">{Number(item['total_qty']).toLocaleString()}잔 / {Number(item['total_sales']).toLocaleString()}원</span>
                                </div>
                                <div className="bar-bg">
                                    <div className="bar-fill" style={{
                                        width: `${(Number(item['total_sales']) / maxItemSales) * 100}%`,
                                        backgroundColor: idx < 3 ? '#ff7043' : '#42a5f5'
                                    }}/>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 2. 시간대별 매출 추이 */}
                <div className="main-card">
                    <h2 className="card-title">⏰ 시간대별 매출 추이</h2>

                    {/* PC: 세로 막대 차트 */}
                    <div className="desktop-time-chart">
                        {stats.timeStats.length === 0 ?
                            <p style={{width: '100%', textAlign: 'center', color: 'var(--text-secondary)'}}>데이터가
                                없습니다.</p> : stats.timeStats.map((time, idx) => (
                                <div key={idx} className="time-col">
                                    <div className="time-val">{Number(time['total_sales']).toLocaleString()}</div>
                                    <div className="time-bar-vertical"
                                         style={{height: `${(Number(time['total_sales']) / maxTimeSales) * 200}px`}}/>
                                    <div className="time-label">{time.hour}시</div>
                                </div>
                            ))}
                    </div>

                    {/* 모바일: 가로 막대 차트 (반응형) */}
                    <div className="mobile-time-chart">
                        {stats.timeStats.length === 0 ? <p style={{color: 'var(--text-secondary)'}}>데이터가
                            없습니다.</p> : stats.timeStats.map((time, idx) => (
                            <div key={idx} className="item-row">
                                <div className="item-info">
                                    <span className="item-name">{time.hour}시</span>
                                    <span
                                        className="item-sales time-val">{Number(time['total_sales']).toLocaleString()}원</span>
                                </div>
                                <div className="bar-bg">
                                    <div className="bar-fill time-bar-vertical" style={{
                                        width: `${(Number(time['total_sales']) / maxTimeSales) * 100}%`,
                                        height: '100%',
                                        borderRadius: 'var(--radius-sm)'
                                    }}/>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default AdvancedStats;