import { useEffect, useState, useRef, useCallback } from 'react';
import axios from 'axios';
import { startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser';

// 서버 챌린지 수명이 15분이라 그보다 넉넉히 앞서 갱신한다.
const REFRESH_MS = 10 * 60 * 1000;
import { useSystemTheme } from '../../hooks/useSystemTheme';
import { useNotification } from '../../hooks/useNotification';
import { getStoreInfo } from '../../utils/storeInfo';
import { readLastMethod, writeLastMethod, consumeSkipAuto, willAutoPasskey } from '../../utils/loginMemory';
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

    // 자동 패스키 호출은 화면당 딱 한 번만 판단한다(아래 effect에서 소비).
    const autoTriedRef = useRef(false);
    // 자동 호출로 띄운 생체인증 창이 아직 떠 있는지. 사용자가 직접 누른 것과 구분해야
    // 화면을 벗어날 때 '자동으로 뜬 것만' 접을 수 있다.
    const autoCeremonyRef = useRef(false);
    // 사용자가 이미 입력을 시작했는지. 서버가 늦게 깨어 자동 패스키가 뒤늦게 준비됐을 때,
    // 아이디를 치고 있는 사람에게 생체인증 창을 들이밀지 않는다.
    const userEngagedRef = useRef(false);
    const usernameRef = useRef(/** @type {HTMLInputElement|null} */ (null));

    /**
     * 아이디칸에 커서를 넣는다 — 패스키 창이 자동으로 뜨지 않을 때만.
     * 자동으로 뜰 때 넣으면 휴대폰에서 키보드가 생체인증 창과 함께 올라온다.
     * 사용자가 이미 다른 칸(비밀번호 등)을 누른 상태면 빼앗지 않는다.
     */
    const focusUsername = useCallback(() => {
        const el = usernameRef.current;
        if (!el) return;
        const active = document.activeElement;
        if (active && active !== document.body && active !== el) return;
        el.focus({ preventScroll: true });
    }, []);

    // 화면이 뜨는 즉시 판단한다. 자동 패스키는 옵션 프리페치를 기다리므로 그 결과를 기다리지 않는다.
    useEffect(() => {
        if (!willAutoPasskey()) focusUsername();
    }, [focusUsername]);

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
        userEngagedRef.current = true;
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    // 로그인 성공 시 공통 처리
    /**
     * @param {any} data
     * @param {'password'|'passkey'} method  다음 방문의 자동 패스키 호출 여부를 결정한다
     */
    const handleSuccess = (data, method) => {
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
        writeLastMethod(method);
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

        // 미리 받은 챌린지는 서버에서 15분 뒤 만료된다. 로그인 화면을 열어둔 채 방치하면
        // 지문까지 찍고 나서 서버 검증에서만 실패한다(실제로 58분 된 챌린지로 실패한 사례가 있었다).
        // 클릭 시점에 새로 받아오면 Safari 제스처가 만료돼 팝업이 안 뜨므로, 미리 갱신해 둔다.
        const timer = setInterval(() => void prefetchAuthOptions(), REFRESH_MS);

        // 폰에서 화면을 껐다 켜거나 앱을 전환했다 돌아오는 경우. 그 사이 흐른 시간은 타이머로 못 메운다.
        const onVisible = () => {
            if (document.visibilityState === 'visible') {
                void prefetchAuthOptions();
                return;
            }
            // 화면을 벗어났다. 자동으로 띄운 생체인증 창이 아직 있으면 여기서 접는다.
            // 접지 않으면 의식이 살아남아, 돌아왔을 때 브라우저가 그 창을 다시 띄운다
            // (요청한 적 없는데 계속 따라붙어 성가시다). 사용자가 직접 누른 창은 건드리지 않는다 —
            // 본인이 의도한 것이고, 돌아와서 이어서 인증하는 게 자연스럽다.
            if (autoCeremonyRef.current) {
                autoCeremonyRef.current = false;
                WebAuthnAbortService.cancelCeremony();
            }
        };
        document.addEventListener('visibilitychange', onVisible);

        // 화면을 벗어날 때 진행 중이던 패스키 의식이 있으면 취소(다음 화면의 create()/get() 차단 방지)
        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
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
                handleSuccess(res.data, 'password');
            }
        } catch (/** @type {any} */ err) {
            if (err.code === 'ECONNABORTED')
                notify('서버 응답이 지연되고 있어요. 잠시 후 다시 시도해주세요.', { icon: '⏳' });
            else notify(err.response?.data?.message || '로그인 실패', { icon: '⚠️' });
        } finally {
            setSubmitting(false);
        }
    };

    /**
     * @param {{auto?: boolean}} [opts]
     *   auto=true는 사용자가 버튼을 누른 게 아니라 화면 진입 시 스스로 호출한 경우다.
     *   요청한 적 없는 동작이므로 실패해도 토스트를 띄우지 않고 조용히 버튼 방식으로 물러난다.
     */
    const handlePasskeyLogin = async ({ auto = false } = {}) => {
        if (submitting) return;

        // 미리 받아 둔 옵션 사용(없으면 폴백으로 즉석에서 받아오지만 Safari에선 팝업이 안 뜰 수 있음)
        let options = passkeyAuthOptions;
        if (!options) {
            try {
                const resp = await axios.get('/api/passkey/login-options');
                options = resp.data;
            } catch {
                if (!auto) notify('패스키 로그인 실패: 등록된 기기가 아니거나 오류가 발생했습니다.', { icon: '⚠️' });
                return;
            }
        }
        setPasskeyAuthOptions(null); // 1회용 챌린지 소진
        setSubmitting(true);
        autoCeremonyRef.current = auto;

        let asseResp;
        try {
            // ⚠️ 이 호출 앞에 await(네트워크)를 두면 Safari에서 제스처가 만료돼 생체인증 팝업이 안 뜬다.
            asseResp = await startAuthentication({ optionsJSON: options });
        } catch (/** @type {any} */ error) {
            setSubmitting(false);
            autoCeremonyRef.current = false;
            void prefetchAuthOptions(); // 다음 시도용 새 옵션 준비
            // 자동으로 띄운 창이 닫혔다 → 비밀번호로 들어올 사람이니 아이디칸으로 안내한다.
            if (auto) focusUsername();
            if (error.name === 'NotAllowedError') {
                // 사용자가 생체인증 창을 취소한 경우. 자동 호출이었다면 더더욱 조용히 넘어간다.
                console.log(auto ? '자동 패스키 인증 취소됨' : '패스키 인증 취소됨');
                return;
            }
            console.error(error);
            if (!auto) notify('패스키 로그인 실패: 등록된 기기가 아니거나 오류가 발생했습니다.', { icon: '⚠️' });
            return;
        }

        try {
            const verificationResp = await axios.post('/api/passkey/login-verify', { body: asseResp });
            if (verificationResp.data.success) {
                handleSuccess(verificationResp.data, 'passkey');
            }
        } catch (/** @type {any} */ error) {
            // 서버가 사유를 code로 알려준다. 만료는 다시 누르면 되는 상황이라
            // '등록된 기기가 아니다'로 뭉뚱그리면 직원이 패스키가 지워진 줄 오해한다.
            const data = error?.response?.data;
            if (auto) focusUsername();
            if (data?.code === 'unknown_passkey') {
                // 서버에서 패스키가 지워졌다. 기억을 지우지 않으면 방문할 때마다 자동 호출로 실패한다.
                writeLastMethod(null);
            }
            if (data?.code === 'challenge_expired') {
                notify(data.message, { icon: '⏱️' });
            } else if (data?.message) {
                notify(data.message, { icon: '⚠️' });
            } else {
                console.error(error);
                if (!auto) notify('패스키 로그인에 실패했습니다. 잠시 후 다시 시도해주세요.', { icon: '⚠️' });
            }
        } finally {
            setSubmitting(false);
            autoCeremonyRef.current = false;
            void prefetchAuthOptions(); // 다음 시도용 새 옵션 준비
        }
    };

    // effect가 최신 handlePasskeyLogin을 보도록 ref에 담아 둔다. 의존성 배열에 함수를 직접
    // 넣으면 렌더마다 effect가 다시 돌고, 렌더 중 대입은 react-hooks/refs가 막는다.
    const passkeyLoginRef = useRef(handlePasskeyLogin);
    useEffect(() => {
        passkeyLoginRef.current = handlePasskeyLogin;
    });

    // 직전 로그인이 패스키였으면 옵션이 준비되는 대로 버튼 없이 곧바로 생체인증을 띄운다.
    // 판단을 effect 안에서 하는 이유: consumeSkipAuto()가 1회용이라 렌더 중에 부르면
    // StrictMode의 이중 렌더가 값을 두 번 소비해 오판한다.
    useEffect(() => {
        if (autoTriedRef.current) return;
        // 프리페치 완료를 기다린다. 콜드스타트 서버를 깨우는 중이면 수 초 걸린다.
        if (!passkeyAuthOptions) return;
        // 백그라운드 탭이면 보지도 않는 생체인증 창이 떠 그대로 취소된다.
        // 여기서는 판단을 확정하지 않고(ref를 세우지 않고) 다음 갱신 때 다시 본다.
        if (document.visibilityState !== 'visible') return;

        autoTriedRef.current = true;
        // 아래 세 경우는 자동 창이 뜨지 않는다. 화면 진입 때 이미 커서를 넣었지만(willAutoPasskey),
        // 판단이 어긋나도 커서 없이 남지 않도록 한 번 더 넣는다(이미 있으면 아무 일도 없다).
        if (readLastMethod() !== 'passkey') return focusUsername(); // 직전 로그인이 비밀번호였다
        if (consumeSkipAuto()) return focusUsername(); // 방금 직접 로그아웃했다 → 이번 한 번은 건너뛴다
        if (userEngagedRef.current) return; // 기다리는 사이 이미 입력을 시작했다
        void passkeyLoginRef.current({ auto: true });
    }, [passkeyAuthOptions, focusUsername]);

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

                <form
                    ref={formRef}
                    onSubmit={handleSubmit}
                    className="login-form"
                    // 칸을 직접 누른 것도 '입력 시작'으로 본다(자동 저장된 값을 고르는 경우 onChange보다 먼저 온다).
                    onPointerDown={() => (userEngagedRef.current = true)}
                >
                    <input
                        ref={usernameRef}
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
                    onClick={() => handlePasskeyLogin()}
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
