import { socket } from './socket';

// ✅ [수정] 부모로부터 isCashierTaken을 받아옵니다.
function RoleSelection({ onSelectRole, isCashierTaken }) {

    const handleCashierClick = () => {
        socket.emit('claim_cashier');
        socket.once('cashier_claimed', (success) => {
            if (success) onSelectRole('cashier');
            else alert("이미 다른 사람이 캐셔를 보고 있습니다!");
        });
    };

    return (
        <div style={containerStyle}>
            <h1 style={{ marginBottom: '40px', color: '#333' }}>역할을 선택해주세요</h1>

            <div style={{ display: 'flex', gap: '30px' }}>
                <button
                    onClick={handleCashierClick}
                    disabled={isCashierTaken}
                    style={{ ...cardStyle, opacity: isCashierTaken ? 0.5 : 1 }}
                >
                    <div style={{ fontSize: '50px' }}>🛒</div>
                    <h2>캐셔 (주문)</h2>
                    {isCashierTaken && <p style={{color:'red'}}>사용 중...</p>}
                </button>

                <button
                    onClick={() => onSelectRole('kitchen')}
                    style={cardStyle}
                >
                    <div style={{ fontSize: '50px' }}>👨‍🍳</div>
                    <h2>주방 (조리)</h2>
                    <p style={{color:'green'}}>언제나 가능</p>
                </button>
            </div>
        </div>
    );
}

const containerStyle = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    height: '100vh', backgroundColor: '#f4f6f8'
};

const cardStyle = {
    width: '300px', height: '400px',
    border: 'none', borderRadius: '20px',
    backgroundColor: 'white', boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
    cursor: 'pointer', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 'bold'
};

export default RoleSelection;