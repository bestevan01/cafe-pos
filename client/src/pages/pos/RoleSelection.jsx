import { useEffect, useRef } from 'react';
import { socket } from '../../utils/socket';
import { useNotification } from '../../hooks/useNotification';

/**
 * @param {object} props
 * @param {(role: 'cashier'|'kitchen') => void} props.onSelectRole
 * @param {boolean} props.isCashierTaken
 * @param {string|null} props.cashierUserName  캐셔 점유자 이름
 * @param {number} props.kitchenUserCount
 * @param {boolean} props.isAdmin  관리자는 1인 제한 예외
 */
function RoleSelection({ onSelectRole, isCashierTaken, cashierUserName, kitchenUserCount, isAdmin }) {
    const { notify } = useNotification();
    const cashierClaimedHandlerRef = useRef(null);

    // 언마운트 시 응답을 아직 못 받은 리스너가 남아있으면 해제(사라진 컴포넌트를 참조하는 클로저 호출 방지)
    useEffect(() => {
        return () => {
            if (cashierClaimedHandlerRef.current) {
                socket.off('cashier_claimed', cashierClaimedHandlerRef.current);
            }
        };
    }, []);

    // ---------------------------------------------------------
    // [1] 이벤트 핸들러
    // ---------------------------------------------------------
    const handleCashierClick = () => {
        // 소켓을 통해 캐셔 역할 선점 시도 (중복 방지)
        socket.emit('claim_cashier');
        const handleCashierClaimed = (success) => {
            if (success) onSelectRole('cashier');
            else notify('이미 다른 사람이 캐셔를 보고 있습니다!', { icon: '⚠️' });
        };
        cashierClaimedHandlerRef.current = handleCashierClaimed;
        socket.once('cashier_claimed', handleCashierClaimed);
    };

    // ---------------------------------------------------------
    // [2] 렌더링 (Render)
    // ---------------------------------------------------------
    return (
        <div className="role-container">
            <style>
                {`
                /* 전체 레이아웃 */
                .role-container {
                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                    min-height: 100dvh; width: 100%;
                    background-color: var(--bg-color, #f4f6f8);
                    padding: 40px 20px; box-sizing: border-box;
                    transition: background-color 0.3s ease;
                }
                .role-title {
                    margin-bottom: 40px; color: var(--text-primary, #333);
                    font-size: 1.8rem; text-align: center; font-weight: bold; word-break: keep-all;
                }
                
                /* 카드 그리드 */
                .role-grid {
                    display: flex; flex-direction: row; gap: 20px;
                    width: 100%; max-width: 800px; justify-content: center;
                }
                
                /* 역할 카드 스타일 */
                .role-card {
                    flex: 1; padding: 20px; height: 280px; 
                    border: 1px solid var(--border-color, transparent); 
                    border-radius: var(--radius-lg); 
                    background-color: var(--card-bg, white);
                    box-shadow: var(--shadow-lg);
                    cursor: pointer; display: flex; align-items: center; justify-content: center; 
                    transition: transform 0.1s, background-color 0.3s, opacity 0.3s;
                    color: var(--text-primary, #333); box-sizing: border-box;
                }
                .role-card:active:not(:disabled) { transform: scale(0.96); }
                .role-card:disabled { cursor: not-allowed; opacity: 0.6; }

                /* 카드 내부 컨텐츠 */
                .role-content-wrapper { display: flex; flex-direction: column; align-items: center; }
                .role-icon { font-size: 4rem; margin-bottom: 15px; }
                .role-name { font-size: 1.4rem; font-weight: bold; margin: 0 0 8px 0; }
                .role-status { font-size: 0.95rem; font-weight: bold; margin: 0; }

                .status-red { color: var(--danger); }
                .status-green { color: var(--success); }

                /* 모바일 화면 최적화 */
                @media (max-width: 768px) {
                    /* 위에서부터 흐르게 + 전역 헤더(사용자메뉴) 아래로 내려오게 상단 여백 확보 */
                    .role-container { justify-content: flex-start; padding: 60px 16px 24px; }
                    .role-title { margin-bottom: 20px; }
                    /* 카드 그리드가 남는 세로 공간을 채우도록(화면 높이에 따라 카드가 커짐) */
                    .role-grid { flex-direction: column; gap: 16px; flex: 1; }
                    .role-card { width: 100%; max-width: 100%; height: auto; padding: 20px; }
                    .role-icon { font-size: 3.5rem; margin-bottom: 10px; }
                    .role-name { font-size: 1.3rem; }
                }
                `}
            </style>

            <h1 className="role-title">역할을 선택해주세요</h1>

            <div className="role-grid">
                {/* 1. 캐셔 버튼 */}
                <button onClick={handleCashierClick} disabled={isCashierTaken && !isAdmin} className="role-card">
                    <div className="role-content-wrapper">
                        <div className="role-icon">🛒</div>
                        <h2 className="role-name">캐셔 (주문)</h2>
                        {isCashierTaken ? (
                            <p className={`role-status ${isAdmin ? 'status-green' : 'status-red'}`}>
                                {cashierUserName ? `${cashierUserName}님 사용 중` : '사용 중...'}
                                {isAdmin && ' (관리자 진입 가능)'}
                            </p>
                        ) : (
                            <p className="role-status status-green">선택 가능</p>
                        )}
                    </div>
                </button>

                {/* 2. 주방 버튼 */}
                <button onClick={() => onSelectRole('kitchen')} className="role-card">
                    <div className="role-content-wrapper">
                        <div className="role-icon">👨‍🍳</div>
                        <h2 className="role-name">주방 (조리)</h2>
                        <p className="role-status status-green">
                            {kitchenUserCount > 0 ? `${kitchenUserCount}명 접속 중` : '대기 중'}
                        </p>
                    </div>
                </button>
            </div>
        </div>
    );
}

export default RoleSelection;
