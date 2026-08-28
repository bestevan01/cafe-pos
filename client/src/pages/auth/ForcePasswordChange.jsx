import { useState } from 'react';
import axios from 'axios';
import { useSystemTheme } from '../../hooks/useSystemTheme';
import { useNotification } from '../../hooks/useNotification';
import Button from '../../components/ui/Button';
import PasswordStrength from '../../components/PasswordStrength';
import { isStrongPassword } from '../../utils/passwordPolicy';

/**
 * 관리자가 임시 비밀번호를 발급한 계정에 로그인 직후 강제로 뜨는 화면.
 * 임시 비밀번호는 구두·메신저로 전달되므로 본인만 아는 값으로 바꿔야 계정이 안전해진다.
 * 되돌아갈 길(뒤로/닫기)을 두지 않고, 로그아웃하거나 새 비밀번호를 정하는 두 갈래만 남긴다.
 *
 * @param {object} props
 * @param {any} props.user 로그인한 사용자
 * @param {() => void} props.onDone 변경 완료 — 앱 진입
 * @param {() => void} props.onLogout
 */
function ForcePasswordChange({ user, onDone, onLogout }) {
    const { notify } = useNotification();
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useSystemTheme();

    const canSubmit = isStrongPassword(password) && password === confirmPassword && !submitting;

    /** @param {import('react').FormEvent<HTMLFormElement>} e */
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        try {
            await axios.patch(
                `/api/users/${user.id}/password`,
                { newPassword: password },
                { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } },
            );
            notify('비밀번호가 변경되었습니다.', { icon: '✅' });
            onDone();
        } catch (/** @type {any} */ err) {
            notify(err.response?.data?.message || '비밀번호 변경에 실패했습니다.', { icon: '⚠️' });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fpc-container">
            <style>
                {`
                .fpc-container {
                    display: flex; justify-content: center; align-items: center;
                    width: 100%; min-height: 100dvh;
                    background-color: var(--bg-color, #f4f6f8);
                    padding: 20px; box-sizing: border-box;
                }
                .fpc-card {
                    background-color: var(--card-bg, white);
                    width: 100%; max-width: 400px;
                    padding: 36px 30px;
                    border-radius: var(--radius-lg);
                    box-shadow: 0 10px 30px rgba(0,0,0,0.08);
                    border: 1px solid var(--border-color, transparent);
                    box-sizing: border-box;
                }
                .fpc-title { margin: 0 0 10px; font-size: 1.35rem; color: var(--text-primary); }
                .fpc-desc {
                    margin: 0 0 22px; font-size: 0.95rem; line-height: 1.6;
                    color: var(--text-secondary); word-break: keep-all;
                }
                .fpc-who {
                    display: inline-block; margin-bottom: 18px; padding: 6px 12px;
                    border-radius: var(--radius-sm); font-size: 0.9rem;
                    background-color: var(--accent-bg); color: var(--accent-hover); font-weight: bold;
                }
                .fpc-form { display: flex; flex-direction: column; gap: 12px; }
                .fpc-input {
                    padding: 14px; border-radius: var(--radius-md);
                    border: 1px solid var(--border-color, #ddd);
                    font-size: 1rem; background-color: var(--bg-color, #f9f9f9);
                    color: var(--text-primary, #333);
                    outline: none; box-sizing: border-box; width: 100%;
                    -webkit-appearance: none;
                }
                .fpc-input:focus { border-color: var(--accent); }
                .fpc-logout {
                    margin-top: 18px; text-align: center; font-size: 0.9rem;
                    color: var(--text-secondary);
                }
                .fpc-logout span { color: var(--accent); cursor: pointer; font-weight: bold; margin-left: 5px; }
                `}
            </style>

            <div className="fpc-card">
                <h2 className="fpc-title">🔑 새 비밀번호를 정해주세요</h2>
                <div className="fpc-who">{user.name}님</div>
                <p className="fpc-desc">
                    관리자가 발급한 임시 비밀번호로 로그인하셨습니다. 임시 비밀번호는 전달 과정에서 다른 사람이 알 수
                    있으므로, 본인만 아는 값으로 바꿔야 계속 사용할 수 있습니다.
                </p>

                <form onSubmit={handleSubmit} className="fpc-form">
                    {/* 비밀번호 관리자가 어느 계정인지 알 수 있도록 숨김 username 필드를 둔다. */}
                    <input
                        type="text"
                        name="username"
                        value={user.username}
                        autoComplete="username"
                        readOnly
                        tabIndex={-1}
                        aria-hidden="true"
                        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
                    />
                    <input
                        type="password"
                        placeholder="새 비밀번호"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="fpc-input"
                        autoComplete="new-password"
                        autoFocus
                        required
                    />
                    <input
                        type="password"
                        placeholder="새 비밀번호 확인"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="fpc-input"
                        autoComplete="new-password"
                        required
                    />
                    <PasswordStrength password={password} confirmPassword={confirmPassword} />
                    <Button type="submit" variant="dark" size="lg" full disabled={!canSubmit}>
                        {submitting ? '변경 중...' : '변경하고 시작하기'}
                    </Button>
                </form>

                <div className="fpc-logout">
                    지금 하지 않으시겠어요?
                    <span onClick={onLogout}>로그아웃</span>
                </div>
            </div>
        </div>
    );
}

export default ForcePasswordChange;
