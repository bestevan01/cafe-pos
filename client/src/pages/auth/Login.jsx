import { useEffect, useState, useRef, useCallback } from 'react';
import axios from 'axios';
import { startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser';
import { useSystemTheme } from '../../hooks/useSystemTheme';
import { useNotification } from '../../hooks/useNotification';
import { getStoreInfo } from '../../utils/storeInfo';
import Button from '../../components/ui/Button';

/**
 * @param {object} props
 * @param {(data: any) => void} props.onLoginSuccess  로그인 성공 시 서버 응답 전달
 * @param {() => void} props.onSwitchToRegister
 */
function Login({ onLoginSuccess, onSwitchToRegister }) {
    // 접속 도메인으로 결정되므로 세션 중 바뀌지 않는다 — 상태로 둘 필요 없음
    const store = getStoreInfo();
    const [formData, setFormData] = useState({ username: '', password: '' });
    const [submitting, setSubmitting] = useState(false);
    const formRef = useRef(/** @type {HTMLFormElement|null} */ (null));
    const { notify } = useNotification();
    // Safari 대응: '패스키로 로그인' 버튼 클릭 시 옵션을 await로 받아오면 제스처가 만료돼 팝업이 안 뜬다.
    // → 옵션을 미리 받아 두고 클릭 시 곧바로 startAuthentication()을 호출한다.
    const [passkeyAuthOptions, setPasskeyAuthOptions] = useState(/** @type {any} */ (null));
    const [showHelp, setShowHelp] = useState(false);

    // 모달이 열려 있는 동안 ESC로 닫는다.
    useEffect(() => {
        if (!showHelp) return;
        /** @param {KeyboardEvent} e */
        const onKey = (e) => {
            if (e.key === 'Escape') setShowHelp(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [showHelp]);

    // 로그인 화면은 시스템(OS) 테마 설정을 따름
    useSystemTheme();

    /** @param {import('react').ChangeEvent<HTMLInputElement>} e */
    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    // 로그인 성공 시 공통 처리
    /** @param {any} data */
    const handleSuccess = (data) => {
        localStorage.setItem('token', data.token);
        localStorage.setItem(
            'user',
            JSON.stringify({
                name: data.name,
                role: data.role,
                username: data.username,
                id: data.id,
                // 관리자가 임시 비밀번호를 발급한 계정이면 App이 변경 화면을 강제로 띄운다.
                mustChangePassword: Boolean(data.mustChangePassword),
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

    /** @param {import('react').AnimationEvent} e */
    const handleAutoFill = (e) => {
        if (e.animationName === 'onAutoFillDetected') {
            // 브라우저가 DOM에 값을 채울 시간을 아주 짧게(50ms) 준 뒤 폼 제출
            setTimeout(() => {
                if (formRef.current) formRef.current.requestSubmit();
            }, 50);
        }
    };

    /** @param {any} e */
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
                /* 매장 구분 띠. 카드 패딩(40px 30px)을 음수 마진으로 상쇄해 상단을 꽉 채운다.
                   align-self: stretch가 없으면 부모의 align-items:center 때문에 글자 폭만큼만 줄어든다. */
                .store-strip {
                    align-self: stretch;
                    margin: -40px -30px 24px -30px;
                    padding: 10px 16px;
                    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
                    font-size: 0.9rem; font-weight: 600; letter-spacing: 0.5px;
                    text-align: center; word-break: keep-all;
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
                
                .forgot-link {
                    margin-top: 18px; text-align: center; font-size: 0.88rem;
                    color: var(--text-secondary, #888); cursor: pointer;
                    background: none; border: none; padding: 4px 8px; font-family: inherit;
                    text-decoration: underline; text-underline-offset: 3px;
                }
                .forgot-link:hover { color: var(--accent); }
                /* 안내는 모달로 띄운다. 카드 안에 펼치면 로그인 폼이 밀려 스크롤이 생긴다. */
                .forgot-overlay {
                    position: fixed; inset: 0; z-index: 9999;
                    background-color: rgba(0,0,0,0.6);
                    display: flex; justify-content: center; align-items: center; padding: 20px;
                }
                .forgot-modal {
                    background-color: var(--card-bg); width: 100%; max-width: 360px;
                    max-height: 85dvh; overflow-y: auto;
                    padding: 26px 24px; border-radius: var(--radius-lg);
                    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
                    box-sizing: border-box; text-align: left;
                }
                .forgot-modal h3 {
                    margin: 0 0 16px; font-size: 1.15rem; color: var(--text-primary); text-align: center;
                }
                .forgot-case { margin-bottom: 16px; font-size: 0.9rem; line-height: 1.65; color: var(--text-secondary); word-break: keep-all; }
                .forgot-case:last-of-type { margin-bottom: 20px; }
                .forgot-case b { display: block; margin-bottom: 4px; color: var(--text-primary); }
                .forgot-case ol { margin: 8px 0 0; padding-left: 20px; }
                .forgot-case li { margin-bottom: 5px; }
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
                {store && (
                    <div className="store-strip" style={{ backgroundColor: store.bg, color: store.fg }}>
                        {store.label}
                    </div>
                )}
                <img src="/logo.svg" alt="Baek's Cafe" className="login-logo" />
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

                <button type="button" className="forgot-link" onClick={() => setShowHelp((v) => !v)}>
                    비밀번호를 잊으셨나요?
                </button>
                {showHelp && (
                    <div className="forgot-overlay" onClick={() => setShowHelp(false)}>
                        <div
                            className="forgot-modal"
                            role="dialog"
                            aria-modal="true"
                            aria-label="비밀번호를 잊었을 때"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <h3>비밀번호를 잊으셨나요?</h3>
                            <div className="forgot-case">
                                <b>패스키를 등록해 두셨다면</b>
                                패스키로 로그인한 뒤, 내 이름 → 내 정보에서 비밀번호를 바꾸실 수 있습니다.
                            </div>
                            <div className="forgot-case">
                                <b>등록해 두지 않으셨다면</b>
                                관리자에게 초기화를 요청하세요.
                                <ol>
                                    <li>관리자가 임시 비밀번호를 알려줍니다.</li>
                                    <li>그 값으로 로그인합니다.</li>
                                    <li>새 비밀번호를 정하는 화면이 자동으로 뜹니다.</li>
                                </ol>
                            </div>
                            <Button onClick={() => setShowHelp(false)} variant="secondary" size="lg" full>
                                닫기
                            </Button>
                        </div>
                    </div>
                )}

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
