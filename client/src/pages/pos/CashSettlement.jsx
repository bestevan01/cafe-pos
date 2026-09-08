import { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { socket } from '../../utils/socket';
import { useNotification } from '../../hooks/useNotification';

// 💵 화폐 단위 정의 (5만원 ~ 10원)
const MONEY_TYPES = [50000, 10000, 5000, 1000, 500, 100, 50, 10];

/**
 * @param {object} props
 * @param {() => void} props.onClose
 */
function CashSettlement({ onClose }) {
    const { notify, confirm } = useNotification();
    // ---------------------------------------------------------
    // [1] 상태 관리 (State)
    // ---------------------------------------------------------
    const [step, setStep] = useState('loading'); // loading, open, close, done
    // 전산상 데이터 (오픈 시재 + 매출)
    const [calcData, setCalcData] = useState(/** @type {import('../../types').SettlementCalc|null} */ (null));
    // 전날 마감 금액
    const [prevClosing, setPrevClosing] = useState(/** @type {number|null} */ (null));

    // 화폐별 개수 상태
    const [counts, setCounts] = useState(
        /** @type {Record<number, number>} */ ({
            50000: 0,
            10000: 0,
            5000: 0,
            1000: 0,
            500: 0,
            100: 0,
            50: 0,
            10: 0,
        }),
    );

    // ---------------------------------------------------------
    // [2] 계산 로직 (Memo)
    // ---------------------------------------------------------
    // 총액 자동 계산
    const totalAmount = useMemo(() => {
        return MONEY_TYPES.reduce((acc, type) => acc + type * (counts[type] || 0), 0);
    }, [counts]);

    // ---------------------------------------------------------
    // [3] API 및 데이터 처리
    // ---------------------------------------------------------
    const getAuthHeader = () => ({
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });

    const fetchCalcData = useCallback(async () => {
        try {
            const res = await axios.get('/api/settlements/calc', getAuthHeader());
            setCalcData(res.data);
            setStep('close');
        } catch {
            notify('오픈 기록이 없습니다.', { icon: '⚠️' });
            setStep('open');
        }
    }, [notify]);

    useEffect(() => {
        axios
            .get('/api/settlements/status', getAuthHeader())
            .then((res) => {
                if (res.data.status === 'not_opened') {
                    setStep('open');
                    const safeAmount = Number(res.data.prevClosing) || 0;
                    setPrevClosing(safeAmount);
                } else if (res.data.status === 'opened') {
                    void fetchCalcData();
                } else {
                    setStep('done');
                }
            })
            .catch((err) => {
                console.error(err);
                notify('데이터 로딩 중 오류가 발생했습니다.', { icon: '⚠️' });
            });
    }, [fetchCalcData, notify]);

    // ---------------------------------------------------------
    // [4] 이벤트 핸들러 (오픈/마감)
    // ---------------------------------------------------------
    /**
     * @param {number} type  화폐 단위
     * @param {string} value  입력값
     */
    const handleCountChange = (type, value) => {
        let numValue = parseInt(value) || 0;
        if (numValue < 0) numValue = 0;
        setCounts((prev) => ({ ...prev, [type]: numValue }));
    };

    const handleOpen = async () => {
        if (
            totalAmount === 0 &&
            !(await confirm('시재금이 0원입니다. 이대로 오픈하시겠습니까?', { confirmText: '오픈' }))
        )
            return;

        if (prevClosing !== null && totalAmount !== prevClosing) {
            const diff = totalAmount - prevClosing;
            const msg = `전날 마감 시재와 다릅니다!\n\n📆 전날 마감: ${prevClosing.toLocaleString()}원\n💵 현재 입력: ${totalAmount.toLocaleString()}원\n❌ 차액: ${diff.toLocaleString()}원\n\n돈이 맞지 않습니다. 그래도 강제로 오픈하시겠습니까?`;
            if (!(await confirm(msg, { title: '⚠️ 시재 불일치', confirmText: '강제 오픈', danger: true }))) return;
        }

        try {
            await axios.post('/api/settlements/open', { amount: totalAmount }, getAuthHeader());
            notify(`오픈 완료! 시작 시재금: ${totalAmount.toLocaleString()}원`, { icon: '✅' });
            onClose();
        } catch (/** @type {any} */ err) {
            notify(err.response?.data?.message || '오픈 처리 실패', { icon: '⚠️' });
        }
    };

    // 마감 화면에 머무는 동안 현금 주문이 들어오면 전산 금액을 다시 받아온다.
    useEffect(() => {
        if (step !== 'close') return undefined;
        const refresh = () => void fetchCalcData();
        socket.on('new_order', refresh);
        socket.on('order_updated', refresh);
        socket.on('order_deleted', refresh);
        return () => {
            socket.off('new_order', refresh);
            socket.off('order_updated', refresh);
            socket.off('order_deleted', refresh);
        };
    }, [step, fetchCalcData]);

    const handleClose = async () => {
        if (!calcData) return;

        // 현금을 세는 동안 들어온 주문이 있을 수 있다. 확인 창을 띄우기 전에 다시 받아와,
        // 캐셔가 보는 차액과 서버가 기록할 차액을 맞춘다.
        // (서버도 마감 시 스스로 다시 계산하므로 장부 자체는 이 조회와 무관하게 정확하다)
        let latest = calcData;
        try {
            const res = await axios.get('/api/settlements/calc', getAuthHeader());
            latest = res.data;
            setCalcData(res.data);
        } catch {
            // 못 받아오면 화면에 있던 값으로 진행한다. 어차피 장부는 서버가 다시 센다.
        }

        const expected = latest.expected;
        const diff = totalAmount - expected;

        if (diff !== 0) {
            if (
                !(await confirm(
                    `전산: ${expected.toLocaleString()}원\n실제: ${totalAmount.toLocaleString()}원\n차액: ${diff.toLocaleString()}원\n\n마감하시겠습니까?`,
                    {
                        title: '⚠️ 금액 불일치',
                        confirmText: '마감',
                    },
                ))
            )
                return;
        }

        try {
            await axios.post(
                '/api/settlements/close',
                // 매출과 차액은 서버가 직접 계산한다. 창을 열어 둔 사이 주문이 더 들어와도
                // 옛 숫자가 장부에 남지 않는다.
                { closingAmount: totalAmount },
                getAuthHeader(),
            );
            notify('마감 처리되었습니다. 수고하셨습니다!', { icon: '🔒' });
            onClose();
        } catch (/** @type {any} */ err) {
            notify(err.response?.data?.message || '마감 처리 실패', { icon: '⚠️' });
        }
    };

    // ---------------------------------------------------------
    // [5] 렌더링 (Render)
    // ---------------------------------------------------------
    const renderMoneyInputs = () => (
        <div className="cs-grid">
            {MONEY_TYPES.map((type) => (
                <div key={type} className="cs-input-row">
                    <span className="cs-label">{type.toLocaleString()}원</span>
                    <span style={{ margin: '0 5px', color: 'var(--text-secondary)' }}>x</span>
                    <input
                        type="number"
                        min="0"
                        value={counts[type] || ''}
                        onChange={(e) => handleCountChange(type, e.target.value)}
                        placeholder="0"
                        className="cs-mini-input"
                    />
                    <span style={{ margin: '0 5px', color: 'var(--text-secondary)' }}>=</span>
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
                .cs-mini-input:focus { border-color: var(--accent); }
                .cs-sub-total { width: 75px; text-align: right; color: var(--text-secondary, #868e96); }
                .cs-total-row { margin-top: 10px; border-top: 2px dashed var(--border-color, #ced4da); padding-top: 10px; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: var(--text-primary, #333); }
                .cs-total-val { color: var(--accent); font-size: 1.3rem; }

                /* 버튼 스타일 */
                .btn-base, .btn-cancel { width: 100%; padding: 14px; border: none; border-radius: var(--radius-md); font-size: 1.05rem; cursor: pointer; font-weight: bold; transition: transform 0.1s; color: white; }
                .btn-base:active, .btn-cancel:active { transform: scale(0.97); }
                .btn-open { background-color: var(--accent); }
                .btn-finish { background-color: var(--success); }
                .btn-cancel { background-color: var(--danger); margin-top: 5px; }

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
                            <div
                                style={{
                                    fontSize: '0.9rem',
                                    color: 'var(--danger)',
                                    fontWeight: 'bold',
                                    backgroundColor: 'var(--danger-bg)',
                                    padding: '8px',
                                    borderRadius: 'var(--radius-sm)',
                                }}
                            >
                                ※ 전날 마감 금액: {prevClosing.toLocaleString()}원
                            </div>
                        )}
                        {renderMoneyInputs()}
                        <button onClick={handleOpen} className="btn-base btn-open">
                            영업 시작 (오픈)
                        </button>
                        <button onClick={onClose} className="btn-cancel">
                            취소 / 닫기
                        </button>
                    </>
                )}

                {/* --- [상황 2: 마감] --- */}
                {step === 'close' && calcData && (
                    <>
                        <div className="cs-info-box">
                            <div className="cs-row">
                                <span>➕ 오픈 시재:</span>
                                <span>{calcData.opening.toLocaleString()}원</span>
                            </div>
                            <div className="cs-row">
                                <span>➕ 현금 매출:</span>
                                <span>{calcData.sales.toLocaleString()}원</span>
                            </div>
                            <hr
                                style={{ margin: '8px 0', border: 'none', borderTop: '1px solid var(--border-color)' }}
                            />
                            <div className="cs-row" style={{ fontWeight: 'bold', color: 'var(--accent)' }}>
                                <span>= 전산상 합계:</span>
                                <span>{calcData.expected.toLocaleString()}원</span>
                            </div>
                        </div>
                        <p className="cs-desc">금고의 현금을 세어서 입력해주세요.</p>
                        {renderMoneyInputs()}

                        <div
                            style={{
                                padding: '10px',
                                borderRadius: 'var(--radius-md)',
                                backgroundColor:
                                    totalAmount - calcData.expected === 0 ? 'var(--success-bg)' : 'var(--danger-bg)',
                                fontWeight: 'bold',
                                color: totalAmount - calcData.expected === 0 ? 'var(--success)' : 'var(--danger)',
                            }}
                        >
                            차액: {(totalAmount - calcData.expected).toLocaleString()}원
                            {totalAmount - calcData.expected === 0 ? ' (정상 ✅)' : ' (불일치 ⚠️)'}
                        </div>
                        <button onClick={handleClose} className="btn-base btn-finish">
                            마감 확정 (퇴근)
                        </button>
                        <button onClick={onClose} className="btn-cancel">
                            취소 / 닫기
                        </button>
                    </>
                )}

                {/* --- [상황 3: 완료] --- */}
                {step === 'done' && (
                    <>
                        <div style={{ fontSize: '3.5rem', margin: '10px 0' }}>🔒</div>
                        <p style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                            오늘의 정산이 완료되었습니다.
                        </p>
                        <button onClick={onClose} className="btn-base btn-open">
                            확인
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

export default CashSettlement;
