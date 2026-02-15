// TODO: 모바일 UI 최적화 필요
// TODO: 다크 / 라이트 / 시스템 테마 제작 및 적용

import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

// 💵 화폐 단위 정의 (5만원 ~ 10원)
const MONEY_TYPES = [50000, 10000, 5000, 1000, 500, 100, 50, 10];

function CashSettlement({ onClose }) {
    const [step, setStep] = useState('loading'); // loading, open, close, done
    const [calcData, setCalcData] = useState(null); // 전산상 데이터

    // 🔢 화폐별 개수 상태 (초기값 모두 0)
    const [counts, setCounts] = useState({
        50000: 0, 10000: 0, 5000: 0, 1000: 0,
        500: 0, 100: 0, 50: 0, 10: 0
    });

    // 🧮 총액 자동 계산 (개수 바뀔 때마다 실행)
    const totalAmount = useMemo(() => {
        return MONEY_TYPES.reduce((acc, type) => {
            return acc + (type * (counts[type] || 0));
        }, 0);
    }, [counts]);

    const [prevClosing, setPrevClosing] = useState(null);

    useEffect(() => {
        axios.get('/api/settlement/status').then(res => {
            if (res.data.status === 'not_opened') {
                setStep('open');

                // 🚨 여기서 'not_opened'라는 글자가 들어가지 않게 확실하게 처리합니다.
                // 값이 없거나 이상하면 무조건 0으로 처리
                const serverPrevAmount = res.data.prevClosing;
                const safeAmount = (serverPrevAmount === undefined || serverPrevAmount === null || isNaN(serverPrevAmount))
                    ? 0
                    : Number(serverPrevAmount);

                setPrevClosing(safeAmount);

            } else if (res.data.status === 'opened') {
                fetchCalcData();
            } else {
                setStep('done');
            }
        }).catch(err => {
            console.error(err);
            alert("데이터 로딩 중 오류가 발생했습니다.");
        });
    }, []);

    const fetchCalcData = async () => {
        try {
            const res = await axios.get('/api/settlement/calc');
            setCalcData(res.data);
            setStep('close');
        } catch (err) {
            alert("오픈 기록이 없습니다.");
            setStep('open');
        }
    };

    // 입력 핸들러
    const handleCountChange = (type, value) => {
        let numValue = parseInt(value) || 0; // 숫자가 아니면 0

        // ✅ [핵심] 음수면 무조건 0으로 고정
        if (numValue < 0) numValue = 0;

        setCounts(prev => ({ ...prev, [type]: numValue }));
    };

    // ☀️ 오픈 처리
    const handleOpen = async () => {
        if (totalAmount === 0) {
            if (!window.confirm("시재금이 0원입니다. 이대로 오픈하시겠습니까?")) return;
        }

        if (prevClosing !== null && totalAmount !== prevClosing) {
            const diff = totalAmount - prevClosing;
            const msg = `⚠️ 경고: 전날 마감 시재와 다릅니다!\n\n` +
                `📆 전날 마감: ${prevClosing.toLocaleString()}원\n` +
                `💵 현재 입력: ${totalAmount.toLocaleString()}원\n` +
                `❌ 차액: ${diff.toLocaleString()}원\n\n` +
                `돈이 맞지 않습니다. 그래도 강제로 오픈하시겠습니까?`;

            // "취소" 누르면 함수 종료 (오픈 안 함)
            if (!window.confirm(msg)) return;
        }

        try {
            // 서버에는 '총액'만 보냅니다.
            await axios.post('/api/settlement/open', { amount: totalAmount });
            alert(`✅ 오픈 완료! 시작 시재금: ${totalAmount.toLocaleString()}원`);
            onClose();
        } catch (err) {
            alert("오픈 처리 실패");
        }
    };

    // 🌙 마감 처리
    const handleClose = async () => {
        const expected = calcData.expected;
        const diff = totalAmount - expected;

        if (diff !== 0) {
            if (!window.confirm(`⚠️ 금액 불일치!\n\n전산: ${expected.toLocaleString()}원\n실제: ${totalAmount.toLocaleString()}원\n차액: ${diff.toLocaleString()}원\n\n마감하시겠습니까?`)) {
                return;
            }
        }

        try {
            await axios.post('/api/settlement/close', {
                closingAmount: totalAmount,
                salesCash: calcData.sales,
                diff: diff
            });
            alert("🔒 마감 처리되었습니다. 수고하셨습니다!");
            onClose();
        } catch (err) {
            alert("마감 처리 실패");
        }
    };

    // 공통으로 쓸 화폐 입력 UI 렌더링 함수
    const renderMoneyInputs = () => (
        <div style={gridStyle}>
            {MONEY_TYPES.map(type => (
                <div key={type} style={inputRowStyle}>
                    <span style={labelStyle}>{type.toLocaleString()}원</span>
                    <span style={{margin:'0 5px'}}>x</span>
                    <input
                        type="number"
                        min="0"
                        value={counts[type] || ''}
                        onChange={(e) => handleCountChange(type, e.target.value)}
                        placeholder="0"
                        style={miniInputStyle}
                    />
                    <span style={{margin:'0 5px'}}>=</span>
                    <span style={subTotalStyle}>
                        {(type * (counts[type] || 0)).toLocaleString()}
                    </span>
                </div>
            ))}
            <div style={totalRowStyle}>
                총 합계: <span style={{color:'#007bff', fontSize:'1.4rem'}}>{totalAmount.toLocaleString()}원</span>
            </div>
        </div>
    );

    if (step === 'loading') return null;

    return (
        <div style={overlayStyle}>
            <div style={modalStyle}>
                <h2 style={{marginTop:0, marginBottom:'10px'}}>💰 시재 점검 (계산기)</h2>

                {/* --- [상황 1: 출근 (오픈)] --- */}
                {step === 'open' && (
                    <div>
                        <p style={{marginBottom:'15px', color:'#666'}}>오픈 준비금을 권종별로 입력해주세요.</p>
                        {prevClosing !== null && (
                            <div style={{marginBottom:'15px', fontSize:'0.9rem', color:'#dc3545', fontWeight:'bold'}}>
                                ※ 전날 마감 금액: {prevClosing.toLocaleString()}원
                            </div>
                        )}
                        {renderMoneyInputs()}
                        <button onClick={handleOpen} style={confirmBtnStyle}>영업 시작 (오픈)</button>
                    </div>
                )}

                {/* --- [상황 2: 퇴근 (마감)] --- */}
                {step === 'close' && calcData && (
                    <div>
                        <div style={infoBoxStyle}>
                            <div style={rowStyle}><span>➕ 오픈 시재:</span> <span>{calcData.opening.toLocaleString()}원</span></div>
                            <div style={rowStyle}><span>➕ 현금 매출:</span> <span>{calcData.sales.toLocaleString()}원</span></div>
                            <hr style={{margin:'10px 0'}}/>
                            <div style={{...rowStyle, fontWeight:'bold', color:'#007bff'}}>
                                <span>= 전산상 합계:</span>
                                <span>{calcData.expected.toLocaleString()}원</span>
                            </div>
                        </div>

                        <p style={{margin:'15px 0', color:'#666'}}>금고의 현금을 세어서 입력해주세요.</p>

                        {renderMoneyInputs()}

                        {/* 차액 표시 */}
                        <div style={{margin:'15px 0', padding:'10px', borderRadius:'8px', backgroundColor: (totalAmount - calcData.expected) === 0 ? '#e8f5e9' : '#ffebee', fontWeight:'bold', color: (totalAmount - calcData.expected) === 0 ? 'green' : 'red'}}>
                            차액: {(totalAmount - calcData.expected).toLocaleString()}원
                            {(totalAmount - calcData.expected) === 0 ? " (정상 ✅)" : " (불일치 ⚠️)"}
                        </div>

                        <button onClick={handleClose} style={closeBtnStyle}>마감 확정 (퇴근)</button>
                    </div>
                )}

                {/* --- [상황 3: 이미 마감됨] --- */}
                {step === 'done' && (
                    <div>
                        <div style={{fontSize:'3rem', marginBottom:'20px'}}>🔒</div>
                        <p style={{fontSize:'1.1rem', fontWeight:'bold'}}>오늘의 정산이 완료되었습니다.</p>
                        <button onClick={onClose} style={cancelBtnStyle}>닫기</button>
                    </div>
                )}

                {step !== 'done' && (
                    <button onClick={onClose} style={cancelBtnStyle}>취소 / 닫기</button>
                )}
            </div>
        </div>
    );
}

// 스타일
const overlayStyle = { position: 'fixed', top:0, left:0, right:0, bottom:0, backgroundColor: 'rgba(0,0,0,0.5)', display:'flex', justifyContent:'center', alignItems:'center', zIndex:2000 };
const modalStyle = { backgroundColor: 'white', padding: '25px', borderRadius: '15px', width: '400px', textAlign: 'center', boxShadow: '0 5px 20px rgba(0,0,0,0.2)', maxHeight:'90vh', overflowY:'auto' };
const infoBoxStyle = { backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '10px', textAlign: 'left', fontSize: '0.95rem' };
const rowStyle = { display: 'flex', justifyContent: 'space-between', marginBottom: '5px' };

const gridStyle = { backgroundColor: '#f1f3f5', padding: '15px', borderRadius: '10px', marginBottom: '15px' };
const inputRowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', fontSize:'0.9rem' };
const labelStyle = { width: '70px', textAlign: 'right', fontWeight:'bold', color:'#495057' };
const miniInputStyle = { width: '60px', padding: '5px', borderRadius: '5px', border: '1px solid #ced4da', textAlign: 'center' };
const subTotalStyle = { width: '80px', textAlign: 'right', color:'#868e96' };
const totalRowStyle = { marginTop: '15px', borderTop: '2px solid #ced4da', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 'bold' };

const confirmBtnStyle = { width: '100%', padding: '15px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1.1rem', cursor: 'pointer', fontWeight: 'bold' };
const closeBtnStyle = { width: '100%', padding: '15px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1.1rem', cursor: 'pointer', fontWeight: 'bold' };
const cancelBtnStyle = { width: '100%', padding: '10px', backgroundColor: 'transparent', color: '#666', border: 'none', marginTop: '5px', cursor: 'pointer', textDecoration: 'underline' };

export default CashSettlement;