// TODO: 다크 / 라이트 / 시스템 테마 제작 및 적용

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
        <div className="settle-container">
            {/* 반응형 & 다크모드 대응 CSS 삽입 */}
            <style>
                {`
                .settle-container {
                    padding: 20px;
                    background-color: var(--bg-color, #f4f6f8);
                    min-height: 100vh;
                    display: flex;
                    flex-direction: column;
                    box-sizing: border-box;
                    transition: background-color 0.3s ease;
                }
                .settle-header {
                    display: flex; align-items: center; gap: 15px; margin-bottom: 20px;
                }
                .settle-title { margin: 0; color: var(--text-primary, #333); font-size: 1.8rem; }
                .btn-back { padding: 10px 15px; background-color: #6c757d; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; }

                .settle-content {
                    background-color: var(--card-bg, white);
                    padding: 20px; border-radius: 20px;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.05);
                    box-sizing: border-box;
                    width: 100%;
                }

                /* 💻 PC 테이블 뷰 */
                .settle-table-view { width: 100%; border-collapse: collapse; }
                .settle-table-view th { 
                    padding: 15px 10px; color: var(--text-secondary, #666); text-align: left; 
                    border-bottom: 2px solid var(--border-color, #ddd); white-space: nowrap; 
                }
                .settle-table-view td { 
                    padding: 15px 10px; color: var(--text-primary, #333); 
                    border-bottom: 1px solid var(--border-color, #eee); white-space: nowrap;
                }

                /* 📱 모바일 카드 뷰 (기본 숨김) */
                .settle-card-view { display: none; }

                /* 뱃지 및 차액 스타일 공통 */
                .badge-open { background-color: #e3f2fd; color: #1565c0; padding: 4px 10px; border-radius: 12px; font-size: 0.85rem; font-weight: bold; display: inline-block; }
                .badge-closed { background-color: #e8f5e9; color: #2e7d32; padding: 4px 10px; border-radius: 12px; font-size: 0.85rem; font-weight: bold; display: inline-block; }
                .diff-good { color: #28a745; font-weight: bold; background-color: #e8f5e9; padding: 5px 10px; border-radius: 15px; display: inline-block; }
                .diff-bad { color: #dc3545; font-weight: bold; background-color: #ffebee; padding: 5px 10px; border-radius: 15px; display: inline-block; }

                /* 📱 모바일 화면 최적화 (768px 이하) */
                @media (max-width: 768px) {
                    .settle-content { padding: 0; background-color: transparent; box-shadow: none; }
                    .settle-table-view { display: none; } /* 모바일에서는 표 숨김 */
                    .settle-card-view { display: flex; flex-direction: column; gap: 15px; } /* 카드 뷰 표시 */
                    
                    .settle-card {
                        background-color: var(--card-bg, white);
                        border-radius: 15px; padding: 20px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.05);
                        border: 1px solid var(--border-color, transparent);
                    }
                    .card-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color, #eee); padding-bottom: 12px; margin-bottom: 12px; }
                    .card-date { font-size: 1.1rem; font-weight: bold; color: var(--text-primary, #333); }
                    
                    .card-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.95rem; color: var(--text-secondary, #666); }
                    .card-val { color: var(--text-primary, #333); font-weight: bold; }
                    
                    /* 전산 합계 줄은 조금 더 눈에 띄게 */
                    .card-total-row { display: flex; justify-content: space-between; padding-top: 10px; margin-top: 10px; border-top: 1px dashed var(--border-color, #ddd); font-size: 1rem; color: #007bff; font-weight: bold; }
                    
                    /* 실제 마감액 및 차액 영역 */
                    .card-closing-section { margin-top: 15px; padding-top: 15px; border-top: 2px solid var(--border-color, #eee); display: flex; justify-content: space-between; align-items: center; }
                    .closing-label { font-size: 0.95rem; color: var(--text-primary, #333); font-weight: bold; }
                    .closing-val { font-size: 1.1rem; color: var(--text-primary, #333); font-weight: bold; }
                }
                `}
            </style>

            <div className="settle-header">
                <button onClick={onBack} className="btn-back">⬅ 뒤로</button>
                <h1 className="settle-title">💰 시재/정산 관리</h1>
            </div>

            <div className="settle-content">
                {loading ? <p style={{color: 'var(--text-secondary)', textAlign: 'center'}}>데이터를 불러오는 중입니다...</p> : (
                    <>
                        {/* 💻 PC 뷰: 기존 테이블 형식 */}
                        <table className="settle-table-view">
                            <thead>
                            <tr>
                                <th>날짜</th>
                                <th>상태</th>
                                <th>오픈 시재</th>
                                <th>+ 현금 매출</th>
                                <th>= 전산 합계</th>
                                <th>실제 마감액</th>
                                <th>차액 (오차)</th>
                            </tr>
                            </thead>
                            <tbody>
                            {settlements.map(item => {
                                const expected = item.opening_amount + item.sales_cash;
                                const isDiff = item.difference !== 0;

                                return (
                                    <tr key={item.id}>
                                        <td>{new Date(item.date).toLocaleDateString()}</td>
                                        <td>
                                            {item.is_closed ? <span className="badge-closed">마감완료</span> : <span className="badge-open">영업중</span>}
                                        </td>
                                        <td>{item.opening_amount.toLocaleString()}원</td>
                                        <td>{item.sales_cash.toLocaleString()}원</td>
                                        <td style={{fontWeight:'bold', color:'#007bff'}}>
                                            {expected.toLocaleString()}원
                                        </td>
                                        <td>
                                            {item.is_closed ? item.closing_amount.toLocaleString() + '원' : '-'}
                                        </td>
                                        <td>
                                            {item.is_closed ? (
                                                <span className={isDiff ? "diff-bad" : "diff-good"}>
                                                        {item.difference > 0 ? '+' : ''}{item.difference.toLocaleString()}원
                                                    </span>
                                            ) : '-'}
                                        </td>
                                    </tr>
                                );
                            })}
                            {settlements.length === 0 && (
                                <tr><td colSpan="7" style={{padding:'30px', textAlign:'center', color:'var(--text-secondary)'}}>정산 기록이 없습니다.</td></tr>
                            )}
                            </tbody>
                        </table>

                        {/* 📱 모바일 뷰: 영수증 형태의 카드 뷰 */}
                        <div className="settle-card-view">
                            {settlements.map(item => {
                                const expected = item.opening_amount + item.sales_cash;
                                const isDiff = item.difference !== 0;

                                return (
                                    <div key={item.id} className="settle-card">
                                        <div className="card-header">
                                            <div className="card-date">{new Date(item.date).toLocaleDateString()}</div>
                                            {item.is_closed ? <span className="badge-closed">마감완료</span> : <span className="badge-open">영업중</span>}
                                        </div>

                                        <div className="card-row">
                                            <span>오픈 시재</span>
                                            <span className="card-val">{item.opening_amount.toLocaleString()}원</span>
                                        </div>
                                        <div className="card-row">
                                            <span>+ 현금 매출</span>
                                            <span className="card-val">{item.sales_cash.toLocaleString()}원</span>
                                        </div>
                                        <div className="card-total-row">
                                            <span>= 전산 합계</span>
                                            <span>{expected.toLocaleString()}원</span>
                                        </div>

                                        {item.is_closed ? (
                                            <div className="card-closing-section">
                                                <div>
                                                    <div className="closing-label">실제 마감액</div>
                                                    <div className="closing-val">{item.closing_amount.toLocaleString()}원</div>
                                                </div>
                                                <div style={{textAlign: 'right'}}>
                                                    <div style={{fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '3px'}}>차액 (오차)</div>
                                                    <span className={isDiff ? "diff-bad" : "diff-good"}>
                                                        {item.difference > 0 ? '+' : ''}{item.difference.toLocaleString()}원
                                                    </span>
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })}
                            {settlements.length === 0 && (
                                <p style={{textAlign:'center', color:'var(--text-secondary)', padding: '20px'}}>정산 기록이 없습니다.</p>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default SettlementDashboard;