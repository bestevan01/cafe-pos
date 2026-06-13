import {useState} from 'react';
import axios from 'axios';
import {startAuthentication} from "@simplewebauthn/browser";
import ThemeToggle from "../../components/ThemeToggle.jsx";
import {useNotification} from '../../hooks/useNotification';

function ProfileAuth({currentUser, onSuccess, onCancel}) {
    const {notify} = useNotification();
    const [password, setPassword] = useState('');

    // ---------------------------------------------------------
    // [1] 비밀번호 인증 핸들러
    // ---------------------------------------------------------
    const handlePasswordAuth = async (e) => {
        e.preventDefault();
        try {
            // 기존 로그인 API를 재사용하여 비밀번호 검증
            const res = await axios.post('/api/login', {
                username: currentUser.username,
                password: password
            });

            if (res.data.success) {
                onSuccess();
            }
        } catch (err) {
            notify("비밀번호가 일치하지 않습니다.", {icon: '⚠️'});
        }
    };

    // ---------------------------------------------------------
    // [2] 패스키(WebAuthn) 인증 핸들러
    // ---------------------------------------------------------
    const handlePasskeyAuth = async () => {
        try {
            const resp = await axios.get('/api/passkey/login-options');
            let asseResp;
            try {
                asseResp = await startAuthentication({optionsJSON: resp.data});
            } catch (error) {
                if (error.name === 'NotAllowedError') return;
                return;
            }

            const verificationResp = await axios.post('/api/passkey/login-verify', {
                body: asseResp,
            });

            if (verificationResp.data.success) {
                // 인증된 사용자가 현재 수정하려는 계정과 일치하는지 확인
                if (verificationResp.data.username === currentUser.username) {
                    onSuccess();
                } else {
                    notify("현재 로그인된 계정의 패스키가 아닙니다.", {icon: '⚠️'});
                }
            }
        } catch (err) {
            console.error(err);
            notify("패스키 인증 실패", {icon: '⚠️'});
        }
    };

    // ---------------------------------------------------------
    // [3] 렌더링 (Render)
    // ---------------------------------------------------------
    return (
        <div className="auth-overlay">
            <div style={{position: 'absolute', top: '20px', right: '20px', zIndex: 1000}}>
                <ThemeToggle/>
            </div>

            <style>
                {`
                /* 모달 오버레이 */
                .auth-overlay {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background-color: rgba(0,0,0,0.6); z-index: 9999;
                    display: flex; justify-content: center; align-items: center; padding: 20px;
                }
                
                /* 모달 카드 */
                .auth-modal {
                    background-color: var(--card-bg); padding: 30px 25px;
                    border-radius: var(--radius-lg); width: 100%; max-width: 340px;
                    text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.2);
                    box-sizing: border-box; transition: background-color 0.3s ease;
                }
                .auth-title { margin-top: 0; color: var(--text-primary); font-size: 1.4rem; }
                .auth-desc { color: var(--text-secondary); margin-bottom: 25px; font-size: 0.95rem; word-break: keep-all; }
                
                /* 입력 폼 */
                .auth-form { display: flex; flex-direction: column; gap: 12px; }
                .auth-input {
                    padding: 14px; border-radius: var(--radius-md); border: 1px solid var(--border-color);
                    font-size: 1rem; background-color: var(--bg-color); color: var(--text-primary);
                    width: 100%; box-sizing: border-box; outline: none; -webkit-appearance: none;
                }
                .auth-input:focus { border-color: #007bff; }
                
                /* 버튼 스타일 */
                .auth-btn {
                    padding: 14px; border-radius: var(--radius-md); border: none;
                    font-weight: bold; cursor: pointer; font-size: 1rem; width: 100%;
                    transition: transform 0.1s, background-color 0.2s;
                }
                .auth-btn:active { transform: scale(0.97); }
                .btn-submit { background-color: #007bff; color: white; }
                .btn-passkey { background-color: #6f42c1; color: white; margin-bottom: 12px; }
                .btn-cancel { background-color: transparent; color: var(--text-secondary); border: 1px solid var(--border-color); }
                
                .divider { margin: 20px 0; color: var(--text-secondary); font-size: 0.85rem; }
                `}
            </style>

            <div className="auth-modal">
                <h2 className="auth-title">🔒 보안 인증</h2>
                <p className="auth-desc">개인정보를 수정하려면<br/>비밀번호 또는 패스키로 인증해주세요.</p>

                <form onSubmit={handlePasswordAuth} className="auth-form">
                    <input
                        type="password"
                        placeholder="비밀번호 입력"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="auth-input"
                        autoComplete="password"
                        autoFocus
                    />
                    <button type="submit" className="auth-btn btn-submit">확인</button>
                </form>

                <div className="divider">또는</div>

                <button onClick={handlePasskeyAuth} className="auth-btn btn-passkey">🔑 패스키로 인증</button>
                <button onClick={onCancel} className="auth-btn btn-cancel">취소</button>
            </div>
        </div>
    );
}

export default ProfileAuth;