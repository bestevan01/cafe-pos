// TODO: 다크 / 라이트 / 시스템 테마 제작 및 적용

import { useState } from 'react';
import axios from 'axios';
import { startAuthentication } from "@simplewebauthn/browser";

function ProfileAuth({ currentUser, onSuccess, onCancel }) {
    const [password, setPassword] = useState('');

    const handlePasswordAuth = async (e) => {
        e.preventDefault();
        try {
            const res = await axios.post('/api/login', {
                username: currentUser.username,
                password: password
            });

            if (res.data.success) {
                onSuccess();
            }
        } catch (err) {
            alert("비밀번호가 일치하지 않습니다.");
        }
    };

    const handlePasskeyAuth = async () => {
        try {
            const resp = await axios.get('/api/passkey/login-options');
            let asseResp;
            try {
                asseResp = await startAuthentication(resp.data);
            } catch (error) {
                if (error.name === 'NotAllowedError') return;
                throw error;
            }

            const verificationResp = await axios.post('/api/passkey/login-verify', {
                body: asseResp,
            });

            if (verificationResp.data.success) {
                if (verificationResp.data.username === currentUser.username) {
                    onSuccess();
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
        <div className="auth-overlay">
            <style>
                {`
                .auth-overlay {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background-color: rgba(0,0,0,0.6);
                    z-index: 9999;
                    display: flex; justify-content: center; align-items: center;
                    padding: 20px;
                }
                .auth-modal {
                    background-color: var(--card-bg); /* ✅ 다크모드 변수 적용 */
                    padding: 30px 25px;
                    border-radius: 20px;
                    width: 100%;
                    max-width: 340px;
                    text-align: center;
                    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
                    box-sizing: border-box;
                    transition: background-color 0.3s ease;
                }
                .auth-title { margin-top: 0; color: var(--text-primary); font-size: 1.4rem; transition: color 0.3s ease; }
                .auth-desc { color: var(--text-secondary); margin-bottom: 25px; font-size: 0.95rem; word-break: keep-all; transition: color 0.3s ease; }
                
                .auth-form { display: flex; flex-direction: column; gap: 12px; }
                
                .auth-input {
                    padding: 14px;
                    border-radius: 12px;
                    border: 1px solid var(--border-color);
                    font-size: 1rem;
                    background-color: var(--bg-color); /* ✅ 다크모드 변수 적용 (입력칸 배경) */
                    color: var(--text-primary); /* ✅ 다크모드 변수 적용 (입력칸 글씨) */
                    -webkit-appearance: none;
                    width: 100%;
                    box-sizing: border-box;
                    transition: background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease;
                }
                .auth-input:focus { outline: none; border-color: #007bff; }
                
                .auth-btn {
                    padding: 14px;
                    border-radius: 12px;
                    border: none;
                    font-weight: bold;
                    cursor: pointer;
                    font-size: 1rem;
                    width: 100%; /* ✅ 버튼을 가로 꽉 차게 변경 */
                    transition: transform 0.1s;
                }
                .auth-btn:active { transform: scale(0.97); }
                
                .btn-submit { background-color: #007bff; color: white; }
                .divider { margin: 20px 0; color: var(--text-secondary); font-size: 0.85rem; }
                
                .btn-passkey { background-color: #6f42c1; color: white; margin-bottom: 12px; }
                .btn-cancel { 
                    background-color: transparent; 
                    color: var(--text-secondary); 
                    border: 1px solid var(--border-color); 
                }
                `}
            </style>

            <div className="auth-modal">
                <h2 className="auth-title">🔒 보안 인증</h2>
                <p className="auth-desc">
                    개인정보를 수정하려면<br/>비밀번호 또는 패스키로 인증해주세요.
                </p>

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

                <button onClick={handlePasskeyAuth} className="auth-btn btn-passkey">
                    🔑 패스키로 인증
                </button>

                <button onClick={onCancel} className="auth-btn btn-cancel">
                    취소
                </button>
            </div>
        </div>
    );
}

export default ProfileAuth;