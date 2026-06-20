import {socket} from '../../utils/socket';
import {useNotification} from '../../hooks/useNotification';

function RoleSelection({onSelectRole, isCashierTaken}) {
    const {notify} = useNotification();

    // ---------------------------------------------------------
    // [1] 이벤트 핸들러
    // ---------------------------------------------------------
    const handleCashierClick = () => {
        // 소켓을 통해 캐셔 역할 선점 시도 (중복 방지)
        socket.emit('claim_cashier');
        socket.once('cashier_claimed', (success) => {
            if (success) onSelectRole('cashier');
            else notify("이미 다른 사람이 캐셔를 보고 있습니다!", {icon: '⚠️'});
        });
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
                    min-height: 100vh; width: 100%;
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
                    .role-grid { flex-direction: column; gap: 20px; }
                    .role-card { width: 100%; max-width: 100%; height: auto; padding: 35px 20px; }
                    .role-icon { font-size: 3.5rem; margin-bottom: 10px; }
                    .role-name { font-size: 1.3rem; }
                }
                `}
            </style>

            <h1 className="role-title">역할을 선택해주세요</h1>

            <div className="role-grid">
                {/* 1. 캐셔 버튼 */}
                <button onClick={handleCashierClick} disabled={isCashierTaken} className="role-card">
                    <div className="role-content-wrapper">
                        <div className="role-icon">🛒</div>
                        <h2 className="role-name">캐셔 (주문)</h2>
                        {isCashierTaken
                            ? <p className="role-status status-red">사용 중...</p>
                            : <p className="role-status status-green">선택 가능</p>
                        }
                    </div>
                </button>

                {/* 2. 주방 버튼 */}
                <button onClick={() => onSelectRole('kitchen')} className="role-card">
                    <div className="role-content-wrapper">
                        <div className="role-icon">👨‍🍳</div>
                        <h2 className="role-name">주방 (조리)</h2>
                        <p className="role-status status-green">언제나 가능</p>
                    </div>
                </button>
            </div>
        </div>
    );
}

export default RoleSelection;