import { useState } from 'react';
import axios from 'axios';
import { startAuthentication } from "@simplewebauthn/browser";

function ProfileAuth({ currentUser, onSuccess, onCancel }) {
    const [password, setPassword] = useState('');

    // 1. 비밀번호로 재인증
    const handlePasswordAuth = async (e) => {
        e.preventDefault();
        try {
            // 기존 로그인 API 재활용 (아이디는 현재 로그인된 정보 사용)
            const res = await axios.post('/api/login', {
                username: currentUser.username,
                password: password
            });

            if (res.data.success) {
                onSuccess(); // 통과!
            }
        } catch (err) {
            alert("비밀번호가 일치하지 않습니다.");
        }
    };

    // 2. 패스키로 재인증
    const handlePasskeyAuth = async () => {
        try {
            // 로그인 옵션 요청
            const resp = await axios.get('/api/passkey/login-options');

            // 브라우저 인증 수행
            let asseResp;
            try {
                asseResp = await startAuthentication(resp.data);
            } catch (error) {
                if (error.name === 'NotAllowedError') return;
                throw error;
            }

            // 서버 검증 요청
            const verificationResp = await axios.post('/api/passkey/login-verify', {
                body: asseResp,
            });

            if (verificationResp.data.success) {
                // 패스키로 인증된 사람이 현재 로그인한 사람과 같은지 체크 (보안 강화)
                if (verificationResp.data.username === currentUser.username) {
                    onSuccess(); // 통과!
                } else {
                    alert("현재 로그인된 계정의 패스키가 아닙니다.");
                }
            }
        } catch (err) {
            console.error(err);
            alert("패스키 인증 실패");
        }
    };

    return (
        <div style={overlayStyle}>
            <div style={modalStyle}>
                <h2 style={{marginTop:0, color:'#333'}}>🔒 보안 인증</h2>
                <p style={{color:'#666', marginBottom:'20px'}}>
                    개인정보를 수정하려면<br/>비밀번호 또는 패스키로 인증해주세요.
                </p>

                {/* 비밀번호 입력 폼 */}
                <form onSubmit={handlePasswordAuth} style={{display:'flex', flexDirection:'column', gap:'10px'}}>
                    <input
                        type="password"
                        placeholder="비밀번호 입력"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        style={inputStyle}
                        autoFocus
                    />
                    <button type="submit" style={btnStyle}>확인</button>
                </form>

                <div style={{margin:'15px 0', color:'#ccc'}}>또는</div>

                {/* 패스키 버튼 */}
                <button onClick={handlePasskeyAuth} style={passkeyBtnStyle}>
                    🔑 패스키로 인증
                </button>

                <button onClick={onCancel} style={cancelBtnStyle}>
                    취소
                </button>
            </div>
        </div>
    );
}

// --- 스타일 ---
const overlayStyle = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999,
    display: 'flex', justifyContent: 'center', alignItems: 'center'
};
const modalStyle = {
    backgroundColor: 'white', padding: '30px', borderRadius: '15px',
    width: '320px', textAlign: 'center', boxShadow: '0 5px 15px rgba(0,0,0,0.3)'
};
const inputStyle = { padding: '12px', borderRadius: '8px', border: '1px solid #ddd', fontSize:'1rem' };
const btnStyle = { padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: '#007bff', color: 'white', fontWeight: 'bold', cursor: 'pointer', fontSize:'1rem' };
const passkeyBtnStyle = { ...btnStyle, backgroundColor: '#6f42c1', marginBottom: '10px' };
const cancelBtnStyle = { ...btnStyle, backgroundColor: 'transparent', color: '#666', border: '1px solid #ddd' };

export default ProfileAuth;