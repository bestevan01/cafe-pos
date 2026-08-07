import { useEffect, useState, useRef, useCallback } from 'react';
import axios from 'axios';
import { startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser';
import { useSystemTheme } from '../../hooks/useSystemTheme';
import { useNotification } from '../../hooks/useNotification';
import Button from '../../components/ui/Button';

/**
 * @param {object} props
 * @param {(data: any) => void} props.onLoginSuccess  로그인 성공 시 서버 응답 전달
 * @param {() => void} props.onSwitchToRegister
 */
function Login({ onLoginSuccess, onSwitchToRegister }) {
    const [formData, setFormData] = useState({ username: '', password: '' });
    const [submitting, setSubmitting] = useState(false);
    const formRef = useRef(null);
    const { notify } = useNotification();
    // Safari 대응: '패스키로 로그인' 버튼 클릭 시 옵션을 await로 받아오면 제스처가 만료돼 팝업이 안 뜬다.
    // → 옵션을 미리 받아 두고 클릭 시 곧바로 startAuthentication()을 호출한다.
    const [passkeyAuthOptions, setPasskeyAuthOptions] = useState(null);

    // 로그인 화면은 시스템(OS) 테마 설정을 따름
    useSystemTheme();

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    // 로그인 성공 시 공통 처리
    const handleSuccess = (data) => {
        localStorage.setItem('token', data.token);
        localStorage.setItem(
            'user',
            JSON.stringify({
                name: data.name,
                role: data.role,
                username: data.username,
                id: data.id,
            }),
        );
        notify(`${data.name}님, 환영합니다!`, { icon: '✅' });
        onLoginSuccess(data);
    };

    // '패스키로 로그인' 버튼용 옵션을 미리(콜드스타트 서버를 깨우면서) 받아 둔다. 챌린지 유효시간은 15분.
    const prefetchAuthOptions = useCallback(async () => {
        try {
            const resp = await axios.get('/api/passkey/login-options');
            setPasskeyAuthOptions(resp.data);
        } catch {
            setPasskeyAuthOptions(null);
        }
    }, []);

    useEffect(() => {
        // 패스키 로그인은 '패스키로 로그인' 버튼으로만 제공한다.
        // (아이디칸 자동완성/Conditional UI는 모바일에서 느리고, 의식이 pending으로 남아 다른 화면을 막는 문제가 있어 제거)
        // 버튼 클릭 시 await 없이 즉시 호출할 수 있도록 옵션만 미리 받아 둔다.
        // prefetchAuthOptions는 useCallback으로 메모이즈된 비동기 함수라 setState가 await 이후에만 일어남(effect 본문에서 동기 호출 아님) — 규칙 오탐.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void prefetchAuthOptions();

        // 화면을 벗어날 때 진행 중이던 패스키 의식이 있으면 취소(다음 화면의 create()/get() 차단 방지)
        return () => {
            WebAuthnAbortService.cancelCeremony();
        };
    }, [prefetchAuthOptions]);

    const handleAutoFill = (e) => {
        if (e.animationName === 'onAutoFillDetected') {
            // 브라우저가 DOM에 값을 채울 시간을 아주 짧게(50ms) 준 뒤 폼 제출
            setTimeout(() => {
                if (formRef.current) formRef.current.requestSubmit();
            }, 50);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (submitting) return; // 중복 제출 방지
        setSubmitting(true);

        const payload = {
            username: e.target.username.value,
            password: e.target.password.value,
        };

        try {
            // 느린 응답 시 로딩 토스트는 전역 인터셉터(NotificationProvider)가 자동 처리
            const res = await axios.post('/api/login', payload);
            if (res.data.success) {
                handleSuccess(res.data);
            }
        } catch (/** @type {any} */ err) {
            if (err.code === 'ECONNABORTED')
                notify('서버 응답이 지연되고 있어요. 잠시 후 다시 시도해주세요.', { icon: '⏳' });
            else notify(err.response?.data?.message || '로그인 실패', { icon: '⚠️' });
        } finally {
            setSubmitting(false);
        }
    };

    const handlePasskeyLogin = async () => {
        if (submitting) return;

        // 미리 받아 둔 옵션 사용(없으면 폴백으로 즉석에서 받아오지만 Safari에선 팝업이 안 뜰 수 있음)
        let options = passkeyAuthOptions;
        if (!options) {
            try {
                const resp = await axios.get('/api/passkey/login-options');
                options = resp.data;
            } catch {
                notify('패스키 로그인 실패: 등록된 기기가 아니거나 오류가 발생했습니다.', { icon: '⚠️' });
                return;
            }
        }
        setPasskeyAuthOptions(null); // 1회용 챌린지 소진
        setSubmitting(true);

        let asseResp;
        try {
            // ⚠️ 이 호출 앞에 await(네트워크)를 두면 Safari에서 제스처가 만료돼 생체인증 팝업이 안 뜬다.
            asseResp = await startAuthentication({ optionsJSON: options });
        } catch (/** @type {any} */ error) {
            setSubmitting(false);
            void prefetchAuthOptions(); // 다음 시도용 새 옵션 준비
            if (error.name === 'NotAllowedError') {
                console.log('패스키 인증 취소됨');
                return;
            }
            console.error(error);
            notify('패스키 로그인 실패: 등록된 기기가 아니거나 오류가 발생했습니다.', { icon: '⚠️' });
            return;
        }

        try {
            const verificationResp = await axios.post('/api/passkey/login-verify', { body: asseResp });
            if (verificationResp.data.success) {
                handleSuccess(verificationResp.data);
            }
        } catch (/** @type {any} */ error) {
            console.error(error);
            notify('패스키 로그인 실패: 등록된 기기가 아니거나 오류가 발생했습니다.', { icon: '⚠️' });
        } finally {
            setSubmitting(false);
            void prefetchAuthOptions(); // 다음 시도용 새 옵션 준비
        }
    };

    return (
        <div className="login-container">
            <style>
                {`
                .login-container {
                    display: flex; justify-content: center; align-items: center;
                    width: 100%; min-height: 100dvh;
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
                .login-logo { width: 210px; max-width: 80%; height: auto; margin: 0 0 16px 0; }
                .login-title { margin: 0 0 25px 0; color: var(--text-secondary, #666); font-size: 1.15rem; font-weight: 500; }
                
                .login-form { width: 100%; display: flex; flex-direction: column; gap: 15px; }
                .login-input {
                    padding: 14px; border-radius: var(--radius-md);
                    border: 1px solid var(--border-color, #ddd);
                    font-size: 1rem; background-color: var(--bg-color, #f9f9f9); color: var(--text-primary, #333);
                    outline: none; box-sizing: border-box; width: 100%;
                    -webkit-appearance: none;
                    transition: border-color 0.3s, background-color 0.3s, color 0.3s;
                }
                .login-input:focus { border-color: var(--accent); }
                .login-input::placeholder { color: var(--text-secondary, #aaa); }
                
                .divider-container { width: 100%; display: flex; align-items: center; margin: 25px 0 15px 0; }
                .divider-line { flex: 1; height: 1px; background-color: var(--border-color, #ddd); transition: background-color 0.3s; }
                .divider-text { padding: 0 15px; color: var(--text-secondary, #999); font-size: 0.85rem; }
                
                .register-text { margin-top: 30px; font-size: 0.95rem; color: var(--text-secondary, #666); }
                .register-link { color: var(--accent); cursor: pointer; font-weight: bold; margin-left: 5px; transition: color 0.2s; }
                .register-link:active { color: var(--accent-hover); }

                /* 패스키 버튼은 문구가 길어 lg 폰트(1.2rem)면 좁은 화면(예: iPhone SE 375px)에서 좌우 패딩을 먹는다 → 폰트만 축소(높이는 유지) */
                .login-card .login-passkey { font-size: 1rem; }
                @media (max-width: 400px) {
                    .login-card .login-passkey { font-size: 0.85rem; }
                }

                @keyframes onAutoFillDetected {
                    from { opacity: 1; }
                    to { opacity: 1; }
                }
                .login-input:-webkit-autofill {
                    animation-name: onAutoFillDetected;
                    animation-duration: 0.1s;
                }
                `}
            </style>

            <div className="login-card">
                <img src="/logo.svg" alt="Baek's Coffee" className="login-logo" />
                <h2 className="login-title">직원 로그인</h2>

                <form ref={formRef} onSubmit={handleSubmit} className="login-form">
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
                        onAnimationStart={handleAutoFill}
                    />
                    <Button type="submit" size="lg" full disabled={submitting}>
                        {submitting ? '로그인 중...' : '로그인'}
                    </Button>
                </form>

                <div className="divider-container">
                    <div className="divider-line"></div>
                    <span className="divider-text">또는</span>
                    <div className="divider-line"></div>
                </div>

                <Button
                    onClick={handlePasskeyLogin}
                    variant="secondary"
                    size="lg"
                    full
                    icon="🔑"
                    className="login-passkey"
                    disabled={submitting}
                >
                    패스키(지문/FaceID)로 로그인
                </Button>

                <div className="register-text">
                    계정이 없으신가요?
                    <span onClick={onSwitchToRegister} className="register-link">
                        회원가입
                    </span>
                </div>
            </div>
        </div>
    );
}

export default Login;
