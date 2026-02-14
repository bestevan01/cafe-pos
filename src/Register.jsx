// TODO: 다크 / 라이트 / 시스템 테마 제작 및 적용

import { useState } from 'react';
import axios from 'axios';

function Register({ onSwitchToLogin }) {
    // ✅ confirmPassword(비밀번호 확인) 상태 추가
    const [formData, setFormData] = useState({ username: '', password: '', confirmPassword: '', name: '' });

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        // ✅ [추가] 비밀번호 일치 여부 검사 로직
        if (formData.password !== formData.confirmPassword) {
            alert("비밀번호가 일치하지 않습니다. 다시 확인해주세요.");
            return; // 일치하지 않으면 서버로 보내지 않고 여기서 멈춤!
        }

        try {
            // 서버로 전송할 때는 confirmPassword 필드를 제외하고 보냅니다.
            const { confirmPassword, ...submitData } = formData;

            const res = await axios.post('/api/register', submitData);
            if (res.data.success) {
                alert(res.data.message); // "관리자 승인을 기다리세요"
                onSwitchToLogin(); // 로그인 화면으로 이동
            }
        } catch (err) {
            alert(err.response?.data?.message || "회원가입 실패");
        }
    };

    return (
        <div className="register-container">
            <style>
                {`
                .register-container {
                    display: flex; justify-content: center; align-items: center;
                    width: 100%; min-height: 100vh;
                    background-color: var(--bg-color, #f4f6f8);
                    padding: 20px; box-sizing: border-box;
                    transition: background-color 0.3s ease;
                }
                .register-card {
                    background-color: var(--card-bg, white);
                    width: 100%; max-width: 380px;
                    padding: 40px 30px;
                    border-radius: 25px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.08);
                    display: flex; flex-direction: column; align-items: center;
                    box-sizing: border-box;
                    border: 1px solid var(--border-color, transparent);
                    transition: background-color 0.3s ease;
                }
                .register-title { margin: 0 0 25px 0; color: var(--text-primary, #333); font-size: 1.6rem; font-weight: bold; }
                
                .register-form { width: 100%; display: flex; flex-direction: column; gap: 15px; }
                .register-input {
                    padding: 14px; border-radius: 12px; border: 1px solid var(--border-color, #ddd);
                    font-size: 1rem; background-color: var(--bg-color, #f9f9f9); color: var(--text-primary, #333);
                    outline: none; box-sizing: border-box; width: 100%;
                    -webkit-appearance: none;
                    transition: border-color 0.3s, background-color 0.3s, color 0.3s;
                }
                .register-input:focus { border-color: var(--text-primary, #333); }
                .register-input::placeholder { color: var(--text-secondary, #aaa); }
                
                .btn-submit {
                    padding: 14px; border-radius: 12px; border: none; 
                    background-color: var(--text-primary, #333); 
                    color: var(--bg-color, white);
                    font-size: 1rem; cursor: pointer; font-weight: bold; width: 100%; margin-top: 5px;
                    transition: transform 0.1s, opacity 0.2s;
                }
                .btn-submit:active { transform: scale(0.97); opacity: 0.8; }
                
                .login-text { margin-top: 30px; font-size: 0.95rem; color: var(--text-secondary, #666); }
                .login-link { color: #007bff; cursor: pointer; font-weight: bold; margin-left: 5px; transition: color 0.2s; }
                .login-link:active { color: #0056b3; }
                `}
            </style>

            <div className="register-card">
                <h2 className="register-title">📝 직원 회원가입</h2>

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
                    {/* ✅ 비밀번호 확인 칸 추가! */}
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
                    <button type="submit" className="btn-submit">가입 신청</button>
                </form>

                <div className="login-text">
                    이미 계정이 있으신가요?
                    <span onClick={onSwitchToLogin} className="login-link">로그인하기</span>
                </div>
            </div>
        </div>
    );
}

export default Register;