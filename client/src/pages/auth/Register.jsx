import { useState } from 'react';
import axios from 'axios';
import { useSystemTheme } from '../../hooks/useSystemTheme.js';
import { useNotification } from '../../hooks/useNotification';
import Button from '../../components/ui/Button';
import PasswordStrength from '../../components/PasswordStrength';
import { isStrongPassword } from '../../utils/passwordPolicy';

/**
 * @param {object} props
 * @param {() => void} props.onSwitchToLogin
 */
function Register({ onSwitchToLogin }) {
    const { notify } = useNotification();
    const [formData, setFormData] = useState({
        username: '',
        password: '',
        confirmPassword: '',
        name: '',
    });

    // 시스템 테마(OS 설정) 강제 적용
    useSystemTheme();

    /** @param {import('react').ChangeEvent<HTMLInputElement>} e */
    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    /** @param {import('react').FormEvent<HTMLFormElement>} e */
    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!isStrongPassword(formData.password)) {
            notify('비밀번호는 8자 이상이며 영문·숫자·특수문자를 모두 포함해야 합니다.', { icon: '⚠️' });
            return;
        }
        if (formData.password !== formData.confirmPassword) {
            notify('비밀번호가 일치하지 않습니다. 다시 확인해주세요.', { icon: '⚠️' });
            return;
        }

        try {
            // API 전송 시 비밀번호 확인 필드는 제외
            const { confirmPassword: _confirmPassword, ...submitData } = formData;

            const res = await axios.post('/api/register', submitData);
            if (res.data.success) {
                notify(res.data.message, { icon: '✅' });
                onSwitchToLogin();
            }
        } catch (/** @type {any} */ err) {
            notify(err.response?.data?.message || '회원가입 실패', { icon: '⚠️' });
        }
    };

    return (
        <div className="register-container">
            <style>
                {`
                .register-container {
                    display: flex; justify-content: center; align-items: center;
                    width: 100%; min-height: 100dvh;
                    background-color: var(--bg-color, #f4f6f8);
                    padding: 20px; box-sizing: border-box;
                    transition: background-color 0.3s ease;
                }
                .register-card {
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
                .register-logo { width: 210px; max-width: 80%; height: auto; margin: 0 0 14px 0; }
                .register-title { margin: 0 0 22px 0; color: var(--text-secondary, #666); font-size: 1.15rem; font-weight: 500; }
                
                .register-form { width: 100%; display: flex; flex-direction: column; gap: 15px; }
                .register-input {
                    padding: 14px; border-radius: var(--radius-md);
                    border: 1px solid var(--border-color, #ddd);
                    font-size: 1rem; background-color: var(--bg-color, #f9f9f9); color: var(--text-primary, #333);
                    outline: none; box-sizing: border-box; width: 100%;
                    -webkit-appearance: none;
                    transition: border-color 0.3s, background-color 0.3s, color 0.3s;
                }
                .register-input:focus { border-color: var(--text-primary, #333); }
                .register-input::placeholder { color: var(--text-secondary, #aaa); }
                
                .login-text { margin-top: 30px; font-size: 0.95rem; color: var(--text-secondary, #666); }
                .login-link { color: var(--accent); cursor: pointer; font-weight: bold; margin-left: 5px; transition: color 0.2s; }
                .login-link:active { color: var(--accent-hover); }
                `}
            </style>

            <div className="register-card">
                <img src="/logo.svg" alt="Baek's Cafe" className="register-logo" />
                <h2 className="register-title">직원 회원가입</h2>

                <form onSubmit={handleSubmit} className="register-form">
                    <input
                        id="username"
                        name="username"
                        type="text"
                        placeholder="아이디"
                        value={formData.username}
                        onChange={handleChange}
                        className="register-input"
                        autoComplete="username"
                        required
                    />
                    <input
                        id="new-password"
                        name="password"
                        type="password"
                        placeholder="비밀번호"
                        value={formData.password}
                        onChange={handleChange}
                        className="register-input"
                        autoComplete="new-password"
                        required
                    />
                    <input
                        id="new-password-confirm"
                        name="confirmPassword"
                        type="password"
                        placeholder="비밀번호 확인"
                        value={formData.confirmPassword}
                        onChange={handleChange}
                        className="register-input"
                        autoComplete="new-password"
                        required
                    />
                    <PasswordStrength password={formData.password} confirmPassword={formData.confirmPassword} />
                    <input
                        id="name"
                        name="name"
                        type="text"
                        placeholder="이름 (예: 홍길동)"
                        value={formData.name}
                        onChange={handleChange}
                        className="register-input"
                        autoComplete="name"
                        required
                    />
                    <Button
                        type="submit"
                        variant="dark"
                        size="lg"
                        full
                        style={{ marginTop: 5 }}
                        disabled={
                            !isStrongPassword(formData.password) || formData.password !== formData.confirmPassword
                        }
                    >
                        가입 신청
                    </Button>
                </form>

                <div className="login-text">
                    이미 계정이 있으신가요?
                    <span onClick={onSwitchToLogin} className="login-link">
                        로그인하기
                    </span>
                </div>
            </div>
        </div>
    );
}

export default Register;
