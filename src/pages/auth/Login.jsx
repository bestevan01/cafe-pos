import {useState} from 'react';
import axios from 'axios';
import { startAuthentication } from "@simplewebauthn/browser";
import {useSystemTheme} from '../../hooks/useSystemTheme';

function Login({ onLoginSuccess, onSwitchToRegister }) {
    const [formData, setFormData] = useState({ username: '', password: '' });

    // 로그인 화면은 시스템(OS) 테마 설정을 따름
    useSystemTheme();

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    // 로그인 성공 시 공통 처리
    const handleSuccess = (data) => {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify({
            name: data.name,
            role: data.role,
            username: data.username,
            id: data.id
        }));
        onLoginSuccess(data);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const res = await axios.post('/api/login', formData);
            if (res.data.success) {
                handleSuccess(res.data);
            }
        } catch (err) {
            alert(err.response?.data?.message || "로그인 실패");
        }
    };

    const handlePasskeyLogin = async () => {
        try {
            // 1. 인증 옵션 요청
            const resp = await axios.get('/api/passkey/login-options');

            // 2. 브라우저 인증 시작 (여기서 에러 나면 바로 아래 catch로 점프)
            const asseResp = await startAuthentication({optionsJSON: resp.data});

            // 3. 서버 검증 요청
            const verificationResp = await axios.post('/api/passkey/login-verify', {
                body: asseResp,
            });

            if (verificationResp.data.success) {
                handleSuccess(verificationResp.data);
            }
        } catch (error) {
            if (error.name === 'NotAllowedError') {
                console.log("패스키 인증 취소됨");
                return;
            }
            console.error(error);
            alert("패스키 로그인 실패: 등록된 기기가 아니거나 오류가 발생했습니다.");
        }
    };

    return (
        <div className="login-container">
            <style>
                {`
                .login-container {
                    display: flex; justify-content: center; align-items: center;
                    width: 100%; min-height: 100vh;
                    background-color: var(--bg-color, #f4f6f8);
                    padding: 20px; box-sizing: border-box;
                    transition: background-color 0.3s ease;
                }
                .login-card {
                    background-color: var(--card-bg, white);
                    width: 100%; max-width: 380px;
                    padding: 40px 30px;
                    border-radius: var(--radius-lg);
                    box-shadow: 0 10px 30px rgba(0,0,0,0.08);
                    display: flex; flex-direction: column; align-items: center;
                    box-sizing: border-box;
                    border: 1px solid var(--border-color, transparent);
                    transition: background-color 0.3s ease;
                }
                .login-emoji { font-size: 3.5rem; margin: 0 0 10px 0; }
                .login-title { margin: 0 0 25px 0; color: var(--text-primary, #333); font-size: 1.6rem; font-weight: bold; }
                
                .login-form { width: 100%; display: flex; flex-direction: column; gap: 15px; }
                .login-input {
                    padding: 14px; border-radius: var(--radius-md);
                    border: 1px solid var(--border-color, #ddd);
                    font-size: 1rem; background-color: var(--bg-color, #f9f9f9); color: var(--text-primary, #333);
                    outline: none; box-sizing: border-box; width: 100%;
                    -webkit-appearance: none;
                    transition: border-color 0.3s, background-color 0.3s, color 0.3s;
                }
                .login-input:focus { border-color: #007bff; }
                .login-input::placeholder { color: var(--text-secondary, #aaa); }
                
                .btn-submit {
                    padding: 14px; border-radius: var(--radius-md);
                    border: none; background-color: #007bff; color: white;
                    font-size: 1rem; cursor: pointer; font-weight: bold; width: 100%;
                    transition: transform 0.1s, background-color 0.2s;
                }
                .btn-submit:active { transform: scale(0.97); background-color: #0056b3; }
                
                .divider-container { width: 100%; display: flex; align-items: center; margin: 25px 0 15px 0; }
                .divider-line { flex: 1; height: 1px; background-color: var(--border-color, #ddd); transition: background-color 0.3s; }
                .divider-text { padding: 0 15px; color: var(--text-secondary, #999); font-size: 0.85rem; }
                
                .btn-passkey {
                    padding: 14px; border-radius: var(--radius-md);
                    border: 1px solid var(--border-color, #ccc);
                    background-color: var(--card-bg, white); color: var(--text-primary, #333);
                    font-size: 1rem; cursor: pointer; font-weight: bold; width: 100%;
                    display: flex; align-items: center; justify-content: center; gap: 8px;
                    transition: transform 0.1s, background-color 0.2s, border-color 0.3s, color 0.3s;
                }
                .btn-passkey:active { transform: scale(0.97); background-color: var(--bg-color, #f4f6f8); }
                
                .register-text { margin-top: 30px; font-size: 0.95rem; color: var(--text-secondary, #666); }
                .register-link { color: #007bff; cursor: pointer; font-weight: bold; margin-left: 5px; transition: color 0.2s; }
                .register-link:active { color: #0056b3; }
                `}
            </style>

            <div className="login-card">
                <div className="login-emoji">☕</div>
                <h2 className="login-title">직원 로그인</h2>

                <form onSubmit={handleSubmit} className="login-form">
                    <input
                        id="username"
                        name="username"
                        placeholder="아이디"
                        value={formData.username}
                        onChange={handleChange}
                        className="login-input"
                        autoComplete="username"
                        required
                    />
                    <input
                        id="current-password"
                        name="password"
                        type="password"
                        placeholder="비밀번호"
                        value={formData.password}
                        onChange={handleChange}
                        className="login-input"
                        autoComplete="current-password"
                        required
                    />
                    <button type="submit" className="btn-submit">로그인</button>
                </form>

                <div className="divider-container">
                    <div className="divider-line"></div>
                    <span className="divider-text">또는</span>
                    <div className="divider-line"></div>
                </div>

                <button onClick={handlePasskeyLogin} className="btn-passkey">
                    🔑 패스키(지문/FaceID)로 로그인
                </button>

                <div className="register-text">
                    계정이 없으신가요?
                    <span onClick={onSwitchToRegister} className="register-link">회원가입</span>
                </div>
            </div>
        </div>
    );
}

export default Login;