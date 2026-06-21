import {useEffect, useState, useRef} from 'react';
import axios from 'axios';
import {startAuthentication, browserSupportsWebAuthnAutofill, WebAuthnAbortService} from "@simplewebauthn/browser";
import {useSystemTheme} from '../../hooks/useSystemTheme';
import {useNotification} from '../../hooks/useNotification';
import Button from '../../components/ui/Button';

function Login({onLoginSuccess, onSwitchToRegister}) {
    const [formData, setFormData] = useState({username: '', password: ''});
    const [submitting, setSubmitting] = useState(false);
    const formRef = useRef(null);
    const {notify} = useNotification();
    // Safari 대응: '패스키로 로그인' 버튼 클릭 시 옵션을 await로 받아오면 제스처가 만료돼 팝업이 안 뜬다.
    // → 옵션을 미리 받아 두고 클릭 시 곧바로 startAuthentication()을 호출한다.
    const [passkeyAuthOptions, setPasskeyAuthOptions] = useState(null);

    // 로그인 화면은 시스템(OS) 테마 설정을 따름
    useSystemTheme();

    const handleChange = (e) => {
        setFormData({...formData, [e.target.name]: e.target.value});
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

    useEffect(() => {
        let cancelled = false;
        const initConditionalPasskey = async () => {
            if (!(await browserSupportsWebAuthnAutofill())) return;

            try {
                const resp = await axios.get('/api/passkey/login-options');
                if (cancelled) return; // 화면을 떠났으면 의식을 시작하지 않음(언마운트 후 input 없음 → "No input" 에러 방지)
                const asseResp = await startAuthentication({
                    optionsJSON: resp.data,
                    useBrowserAutofill: true
                });

                const verificationResp = await axios.post('/api/passkey/login-verify', {
                    body: asseResp,
                });

                if (verificationResp.data.success) {
                    handleSuccess(verificationResp.data);
                }
            } catch (error) {
                // 백그라운드 동작이라 조용히 처리:
                //  - NotAllowedError: 사용자가 취소
                //  - AbortError: '패스키로 로그인' 버튼 클릭 등으로 의식이 중단됨(정상)
                if (error.name === 'NotAllowedError' || error.name === 'AbortError') return;
                console.error(error);
            }
        };

        initConditionalPasskey();
        void prefetchAuthOptions();

        // 로그인 화면을 벗어날 때 대기 중인 Conditional UI 의식(navigator.credentials.get)을 반드시 취소한다.
        // 취소하지 않으면 pending 상태로 남아, 다음 화면(내 정보→기기 등록 등)의 create()/get()을
        // Safari가 "이미 의식 진행 중"으로 보고 NotAllowedError로 차단 → 생체인증 팝업이 안 뜬다.
        return () => {
            cancelled = true;
            WebAuthnAbortService.cancelCeremony();
        };
    }, []);

    // '패스키로 로그인' 버튼용 옵션을 미리(콜드스타트 서버를 깨우면서) 받아 둔다. 챌린지 유효시간은 15분.
    const prefetchAuthOptions = async () => {
        try {
            const resp = await axios.get('/api/passkey/login-options');
            setPasskeyAuthOptions(resp.data);
        } catch {
            setPasskeyAuthOptions(null);
        }
    };

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
            password: e.target.password.value
        };

        try {
            // 느린 응답 시 로딩 토스트는 전역 인터셉터(NotificationProvider)가 자동 처리
            const res = await axios.post('/api/login', payload);
            if (res.data.success) {
                handleSuccess(res.data);
            }
        } catch (err) {
            if (err.code === 'ECONNABORTED') notify("서버 응답이 지연되고 있어요. 잠시 후 다시 시도해주세요.", {icon: '⏳'});
            else notify(err.response?.data?.message || "로그인 실패", {icon: '⚠️'});
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
                notify("패스키 로그인 실패: 등록된 기기가 아니거나 오류가 발생했습니다.", {icon: '⚠️'});
                return;
            }
        }
        setPasskeyAuthOptions(null); // 1회용 챌린지 소진
        setSubmitting(true);

        let asseResp;
        try {
            // ⚠️ 이 호출 앞에 await(네트워크)를 두면 Safari에서 제스처가 만료돼 생체인증 팝업이 안 뜬다.
            asseResp = await startAuthentication({optionsJSON: options});
        } catch (error) {
            setSubmitting(false);
            void prefetchAuthOptions(); // 다음 시도용 새 옵션 준비
            if (error.name === 'NotAllowedError') {
                console.log("패스키 인증 취소됨");
                return;
            }
            console.error(error);
            notify("패스키 로그인 실패: 등록된 기기가 아니거나 오류가 발생했습니다.", {icon: '⚠️'});
            return;
        }

        try {
            const verificationResp = await axios.post('/api/passkey/login-verify', {body: asseResp});
            if (verificationResp.data.success) {
                handleSuccess(verificationResp.data);
            }
        } catch (error) {
            console.error(error);
            notify("패스키 로그인 실패: 등록된 기기가 아니거나 오류가 발생했습니다.", {icon: '⚠️'});
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
                <div className="login-emoji">☕</div>
                <h2 className="login-title">직원 로그인</h2>

                <form ref={formRef} onSubmit={handleSubmit} className="login-form">
                    <input
                        id="username"
                        name="username"
                        placeholder="아이디"
                        value={formData.username}
                        onChange={handleChange}
                        className="login-input"
                        autoComplete="username webauthn"
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

                <Button onClick={handlePasskeyLogin} variant="secondary" size="lg" full icon="🔑"
                        className="login-passkey" disabled={submitting}>
                    패스키(지문/FaceID)로 로그인
                </Button>

                <div className="register-text">
                    계정이 없으신가요?
                    <span onClick={onSwitchToRegister} className="register-link">회원가입</span>
                </div>
            </div>
        </div>
    );
}

export default Login;