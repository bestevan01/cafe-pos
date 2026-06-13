import {useState, useEffect, useMemo} from 'react';
import axios from 'axios';

// 💵 화폐 단위 정의 (5만원 ~ 10원)
const MONEY_TYPES = [50000, 10000, 5000, 1000, 500, 100, 50, 10];

function CashSettlement({onClose}) {
    // ---------------------------------------------------------
    // [1] 상태 관리 (State)
    // ---------------------------------------------------------
    const [step, setStep] = useState('loading'); // loading, open, close, done
    const [calcData, setCalcData] = useState(null); // 전산상 데이터 (오픈 시재 + 매출)
    const [prevClosing, setPrevClosing] = useState(null); // 전날 마감 금액

    // 화폐별 개수 상태
    const [counts, setCounts] = useState({
        50000: 0, 10000: 0, 5000: 0, 1000: 0, 500: 0, 100: 0, 50: 0, 10: 0
    });

    // ---------------------------------------------------------
    // [2] 계산 로직 (Memo)
    // ---------------------------------------------------------
    // 총액 자동 계산
    const totalAmount = useMemo(() => {
        return MONEY_TYPES.reduce((acc, type) => acc + (type * (counts[type] || 0)), 0);
    }, [counts]);

    // ---------------------------------------------------------
    // [3] API 및 데이터 처리
    // ---------------------------------------------------------
    const getAuthHeader = () => ({
        headers: {Authorization: `Bearer ${localStorage.getItem('token')}`}
    });

    useEffect(() => {
        axios.get('/api/settlements/status', getAuthHeader()).then(res => {
            if (res.data.status === 'not_opened') {
                setStep('open');
                const safeAmount = Number(res.data.prevClosing) || 0;
                setPrevClosing(safeAmount);
            } else if (res.data.status === 'opened') {
                void fetchCalcData();
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
            const res = await axios.get('/api/settlements/calc', getAuthHeader());
            setCalcData(res.data);
            setStep('close');
        } catch (err) {
            alert("오픈 기록이 없습니다.");
            setStep('open');
        }
    };

    // ---------------------------------------------------------
    // [4] 이벤트 핸들러 (오픈/마감)
    // ---------------------------------------------------------
    const handleCountChange = (type, value) => {
        let numValue = parseInt(value) || 0;
        if (numValue < 0) numValue = 0;
        setCounts(prev => ({...prev, [type]: numValue}));
    };

    const handleOpen = async () => {
        if (totalAmount === 0 && !window.confirm("시재금이 0원입니다. 이대로 오픈하시겠습니까?")) return;

        if (prevClosing !== null && totalAmount !== prevClosing) {
            const diff = totalAmount - prevClosing;
            const msg = `⚠️ 경고: 전날 마감 시재와 다릅니다!\n\n📆 전날 마감: ${prevClosing.toLocaleString()}원\n💵 현재 입력: ${totalAmount.toLocaleString()}원\n❌ 차액: ${diff.toLocaleString()}원\n\n돈이 맞지 않습니다. 그래도 강제로 오픈하시겠습니까?`;
            if (!window.confirm(msg)) return;
        }

        try {
            await axios.post('/api/settlements/open', {amount: totalAmount}, getAuthHeader());
            alert(`✅ 오픈 완료! 시작 시재금: ${totalAmount.toLocaleString()}원`);
            onClose();
        } catch (err) {
            alert("오픈 처리 실패");
        }
    };

    const handleClose = async () => {
        const expected = calcData.expected;
        const diff = totalAmount - expected;

        if (diff !== 0) {
            if (!window.confirm(`⚠️ 금액 불일치!\n\n전산: ${expected.toLocaleString()}원\n실제: ${totalAmount.toLocaleString()}원\n차액: ${diff.toLocaleString()}원\n\n마감하시겠습니까?`)) return;
        }

        try {
            await axios.post('/api/settlements/close', {
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

    // ---------------------------------------------------------
    // [5] 렌더링 (Render)
    // ---------------------------------------------------------
    const renderMoneyInputs = () => (
        <div className="cs-grid">
            {MONEY_TYPES.map(type => (
                <div key={type} className="cs-input-row">
                    <span className="cs-label">{type.toLocaleString()}원</span>
                    <span style={{margin: '0 5px', color: 'var(--text-secondary)'}}>x</span>
                    <input
                        type="number"
                        min="0"
                        value={counts[type] || ''}
                        onChange={(e) => handleCountChange(type, e.target.value)}
                        placeholder="0"
                        className="cs-mini-input"
                    />
                    <span style={{margin: '0 5px', color: 'var(--text-secondary)'}}>=</span>
                    <span className="cs-sub-total">{(type * (counts[type] || 0)).toLocaleString()}</span>
                </div>
            ))}
            <div className="cs-total-row">
                총 합계: <span className="cs-total-val">{totalAmount.toLocaleString()}원</span>
            </div>
        </div>
    );

    if (step === 'loading') return null;

    return (
        <div className="cs-overlay">
            <style>
                {`
                /* 모달 오버레이 */
                .cs-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(0, 0, 0, 0.6); display: flex; justify-content: center; align-items: center; z-index: 10000; backdrop-filter: blur(3px); }
                
                /* 모달 카드 */
                .cs-modal { background-color: var(--card-bg, #fff); padding: 20px; border-radius: var(--radius-lg); width: 90%; max-width: 380px; text-align: center; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2); max-height: 90vh; overflow-y: auto; border: 1px solid var(--border-color, transparent); box-sizing: border-box; color: var(--text-primary, #333); display: flex; flex-direction: column; gap: 12px; }
                .cs-title { margin: 0; font-size: 1.4rem; color: var(--text-primary, #333); }
                .cs-desc { margin: 0; color: var(--text-secondary, #666); font-size: 0.9rem; }
                
                /* 정보 박스 */
                .cs-info-box { background-color: var(--bg-color, #f8f9fa); padding: 12px; border-radius: var(--radius-md); text-align: left; font-size: 0.9rem; border: 1px solid var(--border-color, #ddd); }
                .cs-row { display: flex; justify-content: space-between; margin-bottom: 6px; color: var(--text-primary, #333); }
                
                /* 계산기 그리드 */
                .cs-grid { background-color: var(--bg-color, #f1f3f5); padding: 12px 15px; border-radius: var(--radius-md); border: 1px solid var(--border-color, #ddd); }
                .cs-input-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 0.95rem; }
                .cs-label { width: 70px; text-align: right; font-weight: bold; color: var(--text-primary, #495057); }
                .cs-mini-input { width: 60px; padding: 4px; border-radius: var(--radius-sm); border: 1px solid var(--border-color, #ced4da); text-align: center; font-size: 1rem; background-color: var(--card-bg, #fff); color: var(--text-primary, #333); outline: none; transition: border-color 0.2s; }
                .cs-mini-input:focus { border-color: #007bff; }
                .cs-sub-total { width: 75px; text-align: right; color: var(--text-secondary, #868e96); }
                .cs-total-row { margin-top: 10px; border-top: 2px dashed var(--border-color, #ced4da); padding-top: 10px; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: var(--text-primary, #333); }
                .cs-total-val { color: #007bff; font-size: 1.3rem; }

                /* 버튼 스타일 */
                .btn-base, .btn-cancel { width: 100%; padding: 14px; border: none; border-radius: var(--radius-md); font-size: 1.05rem; cursor: pointer; font-weight: bold; transition: transform 0.1s; color: white; }
                .btn-base:active, .btn-cancel:active { transform: scale(0.97); }
                .btn-open { background-color: #007bff; }
                .btn-finish { background-color: #28a745; }
                .btn-cancel { background-color: #dc3545; margin-top: 5px; }

                /* 다크모드 대응 */
                [data-theme='dark'] .cs-info-box, [data-theme='dark'] .cs-grid { background-color: rgba(255, 255, 255, 0.05); }
                `}
            </style>

            <div className="cs-modal">
                <h2 className="cs-title">💰 시재 점검 (계산기)</h2>

                {/* --- [상황 1: 오픈] --- */}
                {step === 'open' && (
                    <>
                        <p className="cs-desc">오픈 준비금을 권종별로 입력해주세요.</p>
                        {prevClosing !== null && (
                            <div style={{
                                fontSize: '0.9rem',
                                color: '#dc3545',
                                fontWeight: 'bold',
                                backgroundColor: 'rgba(220,53,69,0.1)',
                                padding: '8px',
                                borderRadius: 'var(--radius-sm)'
                            }}>
                                ※ 전날 마감 금액: {prevClosing.toLocaleString()}원
                            </div>
                        )}
                        {renderMoneyInputs()}
                        <button onClick={handleOpen} className="btn-base btn-open">영업 시작 (오픈)</button>
                        <button onClick={onClose} className="btn-cancel">취소 / 닫기</button>
                    </>
                )}

                {/* --- [상황 2: 마감] --- */}
                {step === 'close' && calcData && (
                    <>
                        <div className="cs-info-box">
                            <div className="cs-row"><span>➕ 오픈 시재:</span> <span>{calcData.opening.toLocaleString()}원</span></div>
                            <div className="cs-row"><span>➕ 현금 매출:</span> <span>{calcData.sales.toLocaleString()}원</span></div>
                            <hr style={{margin: '8px 0', border: 'none', borderTop: '1px solid var(--border-color)'}}/>
                            <div className="cs-row" style={{fontWeight: 'bold', color: '#007bff'}}>
                                <span>= 전산상 합계:</span><span>{calcData.expected.toLocaleString()}원</span>
                            </div>
                        </div>
                        <p className="cs-desc">금고의 현금을 세어서 입력해주세요.</p>
                        {renderMoneyInputs()}

                        <div style={{
                            padding: '10px',
                            borderRadius: 'var(--radius-md)',
                            backgroundColor: (totalAmount - calcData.expected) === 0 ? 'rgba(40,167,69,0.1)' : 'rgba(220,53,69,0.1)',
                            fontWeight: 'bold',
                            color: (totalAmount - calcData.expected) === 0 ? '#28a745' : '#dc3545'
                        }}>
                            차액: {(totalAmount - calcData.expected).toLocaleString()}원
                            {(totalAmount - calcData.expected) === 0 ? " (정상 ✅)" : " (불일치 ⚠️)"}
                        </div>
                        <button onClick={handleClose} className="btn-base btn-finish">마감 확정 (퇴근)</button>
                        <button onClick={onClose} className="btn-cancel">취소 / 닫기</button>
                    </>
                )}

                {/* --- [상황 3: 완료] --- */}
                {step === 'done' && (
                    <>
                        <div style={{fontSize: '3.5rem', margin: '10px 0'}}>🔒</div>
                        <p style={{fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--text-primary)'}}>오늘의 정산이
                            완료되었습니다.</p>
                        <button onClick={onClose} className="btn-base btn-open">확인</button>
                    </>
                )}
            </div>
        </div>
    );
}

export default CashSettlement;