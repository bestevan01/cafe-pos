import { useState, useEffect } from 'react';
import axios from 'axios';
import { startRegistration } from '@simplewebauthn/browser';

function EditProfile({ onBack }) {
    const [user, setUser] = useState({ id: null, name: '', username: '' });
    const [passkeys, setPasskeys] = useState([]);

    // 📺 화면 전환용 상태 (false: 메인 정보 화면 / true: 비밀번호 변경 화면)
    const [isChangingPassword, setIsChangingPassword] = useState(false);

    // 🔒 비밀번호 폼 상태
    const [pwForm, setPwForm] = useState({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
    });

    useEffect(() => {
        const userStr = localStorage.getItem('user');
        if (userStr) {
            const parsedUser = JSON.parse(userStr);
            setUser(parsedUser);
            if (parsedUser.id) {
                fetchPasskeys(parsedUser.id);
            } else {
                console.warn("사용자 ID가 없습니다. 다시 로그인해주세요.");
            }
        }
    }, []);

    const fetchPasskeys = async (userId) => {
        try {
            const res = await axios.get(`/api/passkeys?userId=${userId}`);
            setPasskeys(res.data);
        } catch (err) {
            console.error("패스키 목록 로드 실패");
        }
    };

    const handleChangePassword = async () => {
        if (!pwForm.currentPassword || !pwForm.newPassword || !pwForm.confirmPassword) {
            alert("모든 빈칸을 채워주세요.");
            return;
        }
        if (pwForm.newPassword !== pwForm.confirmPassword) {
            alert("새 비밀번호가 일치하지 않습니다.");
            return;
        }
        if (pwForm.newPassword.length < 4) {
            alert("비밀번호는 최소 4자리 이상이어야 합니다.");
            return;
        }

        if (!window.confirm("비밀번호를 변경하시겠습니까?")) return;

        try {
            const res = await axios.patch(`/api/users/${user.id}/password`, {
                currentPassword: pwForm.currentPassword,
                newPassword: pwForm.newPassword
            });

            if (res.data.success) {
                alert("✅ 비밀번호가 성공적으로 변경되었습니다.");
                // 초기화 및 메인 화면으로 복귀
                setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
                setIsChangingPassword(false);
            }
        } catch (err) {
            alert(err.response?.data?.message || "비밀번호 변경 실패");
        }
    };

    const handleDeletePasskey = async (credentialId) => {
        if (!window.confirm("정말 이 기기를 삭제하시겠습니까?")) return;
        try {
            await axios.delete(`/api/passkeys/${credentialId}`);
            alert("삭제되었습니다.");
            fetchPasskeys(user.id);
        } catch (err) {
            alert("삭제 실패: " + err.message);
        }
    };

    const handleRegisterPasskey = async () => {
        if (!window.confirm("현재 기기를 등록하시겠습니까?")) return;
        try {
            const resp = await axios.get(`/api/passkey/register-options?userId=${user.id}`);
            let attResp;
            try {
                attResp = await startRegistration(resp.data);
            } catch (error) {
                if (error.name === 'InvalidStateError') alert('이미 등록된 기기입니다!');
                else if (error.name !== 'NotAllowedError') alert('등록 오류: ' + error.message);
                throw error;
            }
            const verificationResp = await axios.post('/api/passkey/register-verify', {
                userId: user.id, body: attResp,
            });
            if (verificationResp.data.success) {
                alert('🎉 등록 성공!');
                fetchPasskeys(user.id);
            }
        } catch (error) { console.error(error); }
    };

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.reload();
    };

    return (
        <div style={styles.container}>
            <div style={styles.card}>

                {/* 1️⃣ 비밀번호 변경 화면 */}
                {isChangingPassword ? (
                    <>
                        <h2 style={styles.header}>🔒 비밀번호 변경</h2>
                        <p style={{textAlign: 'center', color: '#666', marginBottom: '20px', fontSize: '0.9rem'}}>
                            안전한 계정 사용을 위해<br/>새로운 비밀번호를 입력해주세요.
                        </p>

                        <div style={styles.passwordBox}>
                            <input
                                type="password"
                                placeholder="현재 비밀번호"
                                value={pwForm.currentPassword}
                                onChange={(e) => setPwForm({...pwForm, currentPassword: e.target.value})}
                                style={styles.input}
                            />
                            <input
                                type="password"
                                placeholder="새 비밀번호"
                                value={pwForm.newPassword}
                                onChange={(e) => setPwForm({...pwForm, newPassword: e.target.value})}
                                style={styles.input}
                            />
                            <input
                                type="password"
                                placeholder="새 비밀번호 확인"
                                value={pwForm.confirmPassword}
                                onChange={(e) => setPwForm({...pwForm, confirmPassword: e.target.value})}
                                style={styles.input}
                            />
                        </div>

                        <div style={styles.footer}>
                            <button onClick={() => setIsChangingPassword(false)} style={styles.cancelBtn}>취소</button>
                            <button onClick={handleChangePassword} style={styles.changeBtn}>변경 저장</button>
                        </div>
                    </>
                ) : (
                    /* 2️⃣ 메인 내 정보 화면 (패스키 목록 넓게 보임) */
                    <>
                        <h2 style={styles.header}>⚙️ 내 정보 수정</h2>

                        <div style={styles.infoRow}>
                            <label style={styles.label}>아이디</label>
                            <input type="text" value={user.username} disabled style={styles.disabledInput} />
                        </div>
                        <div style={styles.infoRow}>
                            <label style={styles.label}>이름</label>
                            <input type="text" value={user.name} disabled style={styles.disabledInput} />
                        </div>

                        {/* 👉 비밀번호 변경 창으로 넘어가는 버튼 */}
                        <button onClick={() => setIsChangingPassword(true)} style={styles.goToPwBtn}>
                            비밀번호 변경하기 〉
                        </button>

                        <hr style={styles.divider} />

                        {/* 🔑 패스키 섹션 (이제 공간이 넓어집니다) */}
                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px'}}>
                            <h3 style={styles.subHeader}>🔐 패스키 관리</h3>
                            <button onClick={handleRegisterPasskey} style={styles.addBtn}>
                                + 기기 등록
                            </button>
                        </div>

                        <div style={styles.listContainer}>
                            {passkeys.length === 0 ? (
                                <p style={{textAlign:'center', color:'#999', padding:'20px'}}>등록된 기기가 없습니다.</p>
                            ) : (
                                passkeys.map((key) => (
                                    <div key={key.id} style={styles.listItem}>
                                        <div>
                                            <div style={{fontWeight:'bold', color:'#333', fontSize:'0.9rem'}}>
                                                {key.device_name}
                                            </div>
                                            <div style={{fontSize:'0.75rem', color:'#888'}}>
                                                {new Date(key.created_at).toLocaleDateString()}
                                            </div>
                                        </div>
                                        <button onClick={() => handleDeletePasskey(key.id)} style={styles.deleteBtn}>
                                            삭제
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>

                        <div style={styles.footer}>
                            <button onClick={onBack} style={styles.backBtn}>뒤로 가기</button>
                            <button onClick={handleLogout} style={styles.logoutBtn}>로그아웃</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// 스타일
const styles = {
    container: { display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100vw', height: '100vh', backgroundColor: '#eef2f5' },
    card: { backgroundColor: 'white', padding: '30px', borderRadius: '20px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', width: '450px', display: 'flex', flexDirection: 'column', gap: '15px' },
    header: { margin: '0 0 10px 0', textAlign: 'center', color: '#333' },
    subHeader: { margin: '0 0 10px 0', fontSize: '1rem', color: '#555', fontWeight:'bold' },
    divider: { margin: '15px 0', border: 'none', borderTop: '1px solid #eee' },
    infoRow: { display: 'flex', flexDirection: 'column', gap: '5px' },
    label: { fontSize: '0.85rem', color: '#666', fontWeight: 'bold' },
    disabledInput: { padding: '10px', borderRadius: '8px', border: '1px solid #ddd', backgroundColor: '#f9f9f9', color: '#555' },

    // 버튼 전환용 스타일 추가
    goToPwBtn: { padding: '8px 0', backgroundColor: 'transparent', color: '#007bff', border: '1px solid #007bff', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem', marginTop: '5px' },

    // 비밀번호 관련 폼 스타일
    passwordBox: { display: 'flex', flexDirection: 'column', gap: '12px', margin: '20px 0' },
    input: { padding: '12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '1rem' },
    changeBtn: { padding: '12px 20px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', flex: 1, marginLeft: '5px' },
    cancelBtn: { padding: '12px 20px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', flex: 1, marginRight: '5px' },

    // 패스키 리스트 높이 넓게 조정
    listContainer: { backgroundColor: '#f8f9fa', borderRadius: '10px', padding: '10px', border: '1px solid #eee', overflowY: 'auto' },
    listItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', borderBottom: '1px solid #eee', backgroundColor: 'white', borderRadius: '8px', marginBottom: '5px' },
    addBtn: { padding: '5px 10px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' },
    deleteBtn: { padding: '5px 10px', backgroundColor: '#ffebeb', color: '#dc3545', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 'bold' },

    footer: { display: 'flex', justifyContent: 'space-between', marginTop: '10px' },
    backBtn: { padding: '10px 18px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight:'bold' },
    logoutBtn: { padding: '10px 18px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight:'bold' }
};

export default EditProfile;