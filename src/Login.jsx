import { useState } from 'react';
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import axios from 'axios';

function Login({ onLoginSuccess, onSwitchToRegister }) {
    const [formData, setFormData] = useState({ username: '', password: '' });

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const res = await axios.post('/api/login', formData);
            if (res.data.success) {
                // 1. 토큰과 유저 정보 저장
                localStorage.setItem('token', res.data.token);
                localStorage.setItem('user', JSON.stringify({
                    name: res.data.name,
                    role: res.data.role,
                    username: res.data.username,
                    id: res.data.id
                }));

                // 2. 부모 컴포넌트(App)에 알림
                onLoginSuccess(res.data);
            }
        } catch (err) {
            // 403 Forbidden 등 에러 처리
            alert(err.response?.data?.message || "로그인 실패");
        }
    };

    const handlePasskeyLogin = async () => {
        try {
            // 1. 옵션 받아오기
            const resp = await axios.get('/api/passkey/login-options');

            // 2. 브라우저/기기 인증 수행 (지문/얼굴 인식 창 뜸)
            let asseResp;
            try {
                asseResp = await startAuthentication(resp.data);
            } catch (error) {
                if (error.name === 'NotAllowedError') return; // 취소함
                throw error;
            }

            // 3. 결과 서버로 전송
            const verificationResp = await axios.post('/api/passkey/login-verify', {
                body: asseResp,
            });

            if (verificationResp.data.success) {
                const data = verificationResp.data;
                // 기존 로그인 성공 처리와 동일
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify({
                    name: data.name,
                    role: data.role,
                    username: data.username
                }));
                onLoginSuccess(data);
            }
        } catch (err) {
            console.error(err);
            alert("패스키 로그인 실패: 등록된 기기가 아니거나 오류가 발생했습니다.");
        }
    };

    return (
        <div style={containerStyle}>
            <div style={cardStyle}>
                <h1 style={{ marginBottom: '30px', fontSize: '3rem' }}>☕</h1>
                <h2 style={{ marginBottom: '20px', color: '#333' }}>직원 로그인</h2>
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px', width: '100%' }}>
                    <input name="username" placeholder="아이디" onChange={handleChange} style={inputStyle} required />
                    <input name="password" type="password" placeholder="비밀번호" onChange={handleChange} style={inputStyle} required />
                    <button type="submit" style={btnStyle}>로그인</button>
                </form>
                <div style={{width: '100%', marginTop: '10px', display:'flex', flexDirection:'column', gap:'5px'}}>
                    <div style={{display:'flex', alignItems:'center', margin:'10px 0'}}>
                        <div style={{flex:1, height:'1px', backgroundColor:'#ddd'}}></div>
                        <span style={{padding:'0 10px', color:'#999', fontSize:'0.8rem'}}>또는</span>
                        <div style={{flex:1, height:'1px', backgroundColor:'#ddd'}}></div>
                    </div>
                    <button
                        onClick={handlePasskeyLogin}
                        style={{...btnStyle, backgroundColor: '#fff', color:'#333', border:'1px solid #ccc', display:'flex', alignItems:'center', justifyContent:'center', gap:'8px'}}
                    >
                        🔑 패스키(지문/FaceID)로 로그인
                    </button>
                </div>
                <p style={{ marginTop: '15px', fontSize: '0.9rem', color: '#666' }}>
                    계정이 없으신가요? <span onClick={onSwitchToRegister} style={{ color: '#007bff', cursor: 'pointer', fontWeight: 'bold' }}>회원가입</span>
                </p>
            </div>
        </div>
    );
}

const containerStyle = { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#f0f2f5' };
const cardStyle = { width: '350px', padding: '40px', backgroundColor: 'white', borderRadius: '15px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', alignItems: 'center' };
const inputStyle = { padding: '12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '1rem' };
const btnStyle = { padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: '#007bff', color: 'white', fontSize: '1rem', cursor: 'pointer', fontWeight: 'bold', marginTop: '10px' };

export default Login;