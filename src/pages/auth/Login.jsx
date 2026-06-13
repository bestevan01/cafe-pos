import {useState} from 'react';
import axios from 'axios';
import {startAuthentication} from "@simplewebauthn/browser";
import {useSystemTheme} from '../../hooks/useSystemTheme';
import {useNotification} from '../../hooks/useNotification';

function Login({onLoginSuccess, onSwitchToRegister}) {
    const [formData, setFormData] = useState({username: '', password: ''});
    const [submitting, setSubmitting] = useState(false);
    const {notify, update, dismiss} = useNotification();

    // 로그인 화면은 시스템(OS) 테마 설정을 따름
    useSystemTheme();

    const handleChange = (e) => {
        setFormData({...formData, [e.target.name]: e.target.value});
    };

    // 서버 응답을 기다리는 동안 로딩 모달 표시.
    // 4초 넘게 걸리면(콜드 스타트로 추정) 안내 문구를 바꿔 사용자를 안심시킨다.
    const runWithStatus = async (task) => {
        setSubmitting(true);
        const toastId = notify('잠시만 기다려주세요...', {loading: true, title: '로그인 중', duration: 0});
        const slowTimer = setTimeout(() => {
            update(toastId, {message: '서버를 깨우는 중이에요. 최대 1분 정도 걸릴 수 있어요 ☕'});
        }, 4000);
        try {
            // [임시/테스트용] 로컬은 응답이 즉시라 로딩 토스트를 볼 수 없어, 개발 모드에서만 10초 지연.
            // import.meta.env.DEV는 프로덕션 빌드에서 false라 배포본엔 적용되지 않음. 확인 끝나면 이 줄만 삭제.
            if (import.meta.env.DEV) await new Promise(resolve => setTimeout(resolve, 10000));
            return await task();
        } finally {
            clearTimeout(slowTimer);
            dismiss(toastId);
            setSubmitting(false);
        }
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
        notify(`${data.name}님, 환영합니다!`, {icon: '✅'});
        onLoginSuccess(data);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (submitting) return; // 중복 제출 방지
        try {
            const res = await runWithStatus(() => axios.post('/api/login', formData));
            if (res.data.success) {
                handleSuccess(res.data);
            }
        } catch (err) {
            if (err.code === 'ECONNABORTED') notify("서버 응답이 지연되고 있어요. 잠시 후 다시 시도해주세요.", {icon: '⏳'});
            else notify(err.response?.data?.message || "로그인 실패", {icon: '⚠️'});
        }
    };

    const handlePasskeyLogin = async () => {
        try {
            // 1. 인증 옵션 요청 (서버 통신 — 로딩 표시)
            const resp = await runWithStatus(() => axios.get('/api/passkey/login-options'));

            // 2. 브라우저 인증 시작 (OS 생체인증 프롬프트 — 로딩 모달은 띄우지 않음)
            const asseResp = await startAuthentication({optionsJSON: resp.data});

            // 3. 서버 검증 요청 (서버 통신 — 로딩 표시)
            const verificationResp = await runWithStatus(() => axios.post('/api/passkey/login-verify', {
                body: asseResp,
            }));

            if (verificationResp.data.success) {
                handleSuccess(verificationResp.data);
            }
        } catch (error) {
            if (error.name === 'NotAllowedError') {
                console.log("패스키 인증 취소됨");
                return;
            }
            console.error(error);
            notify("패스키 로그인 실패: 등록된 기기가 아니거나 오류가 발생했습니다.", {icon: '⚠️'});
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
                .btn-submit:disabled, .btn-passkey:disabled { opacity: 0.6; cursor: not-allowed; }
                
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
                    <button type="submit" className="btn-submit" disabled={submitting}>
                        {submitting ? '로그인 중...' : '로그인'}
                    </button>
                </form>

                <div className="divider-container">
                    <div className="divider-line"></div>
                    <span className="divider-text">또는</span>
                    <div className="divider-line"></div>
                </div>

                <button onClick={handlePasskeyLogin} className="btn-passkey" disabled={submitting}>
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