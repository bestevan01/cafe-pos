import { useState } from 'react';
import axios from 'axios';

function Register({ onSwitchToLogin }) {
    const [formData, setFormData] = useState({ username: '', password: '', name: '' });

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const res = await axios.post('/api/register', formData);
            if (res.data.success) {
                alert(res.data.message); // "관리자 승인을 기다리세요"
                onSwitchToLogin(); // 로그인 화면으로 이동
            }
        } catch (err) {
            alert(err.response?.data?.message || "회원가입 실패");
        }
    };

    return (
        <div style={containerStyle}>
            <div style={cardStyle}>
                <h2 style={{ marginBottom: '20px', color: '#333' }}>📝 직원 회원가입</h2>
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px', width: '100%' }}>
                    <input name="username" placeholder="아이디" onChange={handleChange} style={inputStyle} required />
                    <input name="password" type="password" placeholder="비밀번호" onChange={handleChange} style={inputStyle} required />
                    <input name="name" placeholder="이름 (예: 홍길동)" onChange={handleChange} style={inputStyle} required />
                    <button type="submit" style={btnStyle}>가입 신청</button>
                </form>
                <p style={{ marginTop: '15px', fontSize: '0.9rem', color: '#666' }}>
                    이미 계정이 있으신가요? <span onClick={onSwitchToLogin} style={{ color: '#007bff', cursor: 'pointer', fontWeight: 'bold' }}>로그인하기</span>
                </p>
            </div>
        </div>
    );
}

// 스타일 (Login.jsx와 공유해도 됨)
const containerStyle = { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#f0f2f5' };
const cardStyle = { width: '350px', padding: '40px', backgroundColor: 'white', borderRadius: '15px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', alignItems: 'center' };
const inputStyle = { padding: '12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '1rem' };
const btnStyle = { padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: '#333', color: 'white', fontSize: '1rem', cursor: 'pointer', fontWeight: 'bold', marginTop: '10px' };

export default Register;