import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser';
import { useNotification } from '../../hooks/useNotification';
import Button from '../../components/ui/Button';

/**
 * @param {object} props
 * @param {any} props.currentUser  현재 로그인 사용자
 * @param {() => void} props.onSuccess
 * @param {() => void} props.onCancel
 */
function ProfileAuth({ currentUser, onSuccess, onCancel }) {
    const { notify } = useNotification();
    const [password, setPassword] = useState('');
    const formRef = useRef(/** @type {HTMLFormElement|null} */ (null));

    useEffect(() => {
        // 이전 화면에서 남은 WebAuthn 의식이 있으면 취소한다.
        WebAuthnAbortService.cancelCeremony();

        // 인증 도중 사용자가 모달을 취소하거나 강제 언마운트되면 진행 중인 의식을 취소한다.
        // (Safari는 남은 의식을 "진행 중"으로 보고 다음 create()/get()을 NotAllowedError로 조용히 막는다.)
        return () => {
            WebAuthnAbortService.cancelCeremony();
        };
    }, []);

    // ---------------------------------------------------------
    // [1] 비밀번호 인증 핸들러
    // ---------------------------------------------------------
    /** @param {any} e */
    const handlePasswordAuth = async (e) => {
        e.preventDefault();
        try {
            // 기존 로그인 API를 재사용하여 비밀번호 검증 (자동완성 대응: 폼 DOM 값을 직접 읽음)
            const res = await axios.post('/api/login', {
                username: currentUser.username,
                password: e.target.password.value,
            });

            if (res.data.success) {
                onSuccess();
            }
        } catch {
            notify('비밀번호가 일치하지 않습니다.', { icon: '⚠️' });
        }
    };

    // 비밀번호 자동완성이 채워지면(:-webkit-autofill 애니메이션 감지) 자동으로 제출 — 로그인 화면과 동일 동작
    /** @param {import('react').AnimationEvent} e */
    const handleAutoFill = (e) => {
        if (e.animationName === 'onAutoFillDetected') {
            // 브라우저가 DOM에 값을 채울 시간을 짧게(50ms) 준 뒤 폼 제출
            setTimeout(() => {
                if (formRef.current) formRef.current.requestSubmit();
            }, 50);
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
                asseResp = await startAuthentication({ optionsJSON: resp.data });
            } catch (/** @type {any} */ error) {
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
                    notify('현재 로그인된 계정의 패스키가 아닙니다.', { icon: '⚠️' });
                }
            }
        } catch (/** @type {any} */ err) {
            console.error(err);
            notify('패스키 인증 실패', { icon: '⚠️' });
        }
    };

    // ---------------------------------------------------------
    // [3] 렌더링 (Render)
    // ---------------------------------------------------------
    return (
        <div className="auth-overlay">
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
                .auth-input:focus { border-color: var(--accent); }

                /* 비밀번호 자동완성 감지용 애니메이션(값이 채워질 때 onAnimationStart 발화) */
                @keyframes onAutoFillDetected { from { opacity: 1; } to { opacity: 1; } }
                .auth-input:-webkit-autofill { animation-name: onAutoFillDetected; animation-duration: 0.1s; }
                
                /* 버튼 스타일 */
                .auth-btn {
                    padding: 14px; border-radius: var(--radius-md); border: none;
                    font-weight: bold; cursor: pointer; font-size: 1rem; width: 100%;
                    transition: transform 0.1s, background-color 0.2s;
                }
                .auth-btn:active { transform: scale(0.97); }
                .btn-passkey { background-color: #6f42c1; color: white; margin-bottom: 12px; }
                
                .divider { margin: 20px 0; color: var(--text-secondary); font-size: 0.85rem; }
                `}
            </style>

            <div className="auth-modal">
                <h2 className="auth-title">🔒 보안 인증</h2>
                <p className="auth-desc">
                    개인정보를 수정하려면
                    <br />
                    비밀번호 또는 패스키로 인증해주세요.
                </p>

                <form ref={formRef} onSubmit={handlePasswordAuth} className="auth-form">
                    {/* Safari/iCloud 키체인이 저장된 비밀번호를 자동완성하려면 폼 안에 username 필드가 있어야 한다(화면엔 숨김). */}
                    <input
                        type="text"
                        name="username"
                        value={currentUser.username}
                        autoComplete="username"
                        readOnly
                        tabIndex={-1}
                        aria-hidden="true"
                        style={{
                            position: 'absolute',
                            width: 1,
                            height: 1,
                            padding: 0,
                            border: 0,
                            opacity: 0,
                            pointerEvents: 'none',
                        }}
                    />
                    <input
                        type="password"
                        name="password"
                        placeholder="비밀번호 입력"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="auth-input"
                        autoComplete="current-password"
                        onAnimationStart={handleAutoFill}
                        autoFocus
                    />
                    <Button type="submit" size="lg" full>
                        확인
                    </Button>
                </form>

                <div className="divider">또는</div>

                <button onClick={handlePasskeyAuth} className="auth-btn btn-passkey">
                    🔑 패스키로 인증
                </button>
                <Button onClick={onCancel} variant="secondary" size="lg" full>
                    취소
                </Button>
            </div>
        </div>
    );
}

export default ProfileAuth;
