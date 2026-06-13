import {useState, useEffect} from 'react';
import axios from 'axios';
import ThemeToggle from '../../components/ThemeToggle';
import {startRegistration} from '@simplewebauthn/browser';
import {useNotification} from '../../hooks/useNotification';

function EditProfile({onBack}) {
    const {notify, confirm} = useNotification();
    // ---------------------------------------------------------
    // [1] 상태 관리 (State)
    // ---------------------------------------------------------
    const [user, setUser] = useState({id: null, name: '', username: ''});
    const [passkeys, setPasskeys] = useState([]);
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    const [pwForm, setPwForm] = useState({currentPassword: '', newPassword: '', confirmPassword: ''});

    // ---------------------------------------------------------
    // [2] API 및 데이터 처리
    // ---------------------------------------------------------
    const getAuthHeader = () => ({
        headers: {Authorization: `Bearer ${localStorage.getItem('token')}`}
    });

    useEffect(() => {
        const userStr = localStorage.getItem('user');
        if (userStr) {
            const parsedUser = JSON.parse(userStr);
            setUser(parsedUser);
            if (parsedUser.id) void fetchPasskeys(parsedUser.id);
        }
    }, []);

    const fetchPasskeys = async (userId) => {
        try {
            const res = await axios.get(`/api/passkeys?userId=${userId}`, getAuthHeader());
            setPasskeys(res.data);
        } catch (err) {
            console.error("패스키 목록 로드 실패");
        }
    };

    const handleChangePassword = async () => {
        if (!pwForm.currentPassword || !pwForm.newPassword || !pwForm.confirmPassword) return notify("모든 빈칸을 채워주세요.", {icon: '⚠️'});
        if (pwForm.newPassword !== pwForm.confirmPassword) return notify("새 비밀번호가 일치하지 않습니다.", {icon: '⚠️'});
        if (pwForm.newPassword.length < 4) return notify("비밀번호는 최소 4자리 이상이어야 합니다.", {icon: '⚠️'});
        if (!(await confirm("비밀번호를 변경하시겠습니까?", {confirmText: "변경"}))) return;

        try {
            const res = await axios.patch(`/api/users/${user.id}/password`, {
                currentPassword: pwForm.currentPassword,
                newPassword: pwForm.newPassword
            }, getAuthHeader());

            if (res.data.success) {
                notify("비밀번호가 성공적으로 변경되었습니다.", {icon: '✅'});
                setPwForm({currentPassword: '', newPassword: '', confirmPassword: ''});
                setIsChangingPassword(false);
            }
        } catch (err) {
            notify(err.response?.data?.message || "비밀번호 변경 실패", {icon: '⚠️'});
        }
    };

    // ---------------------------------------------------------
    // [3] 패스키(WebAuthn) 핸들러
    // ---------------------------------------------------------
    const handleRegisterPasskey = async () => {
        try {
            const resp = await axios.get(`/api/passkey/register-options?userId=${user.id}`, getAuthHeader());
            let attResp;
            try {
                attResp = await startRegistration(resp.data);
            } catch (error) {
                if (error.name === 'InvalidStateError') notify('이미 등록된 기기입니다!', {icon: '⚠️'});
                else if (error.name !== 'NotAllowedError') notify('등록 오류: ' + error.message, {icon: '⚠️'});
                return;
            }

            const verificationResp = await axios.post('/api/passkey/register-verify', {
                userId: user.id, body: attResp,
            }, getAuthHeader());

            if (verificationResp.data.success) {
                await fetchPasskeys(user.id);
            }
        } catch (error) {
            console.error(error);
        }
    };

    const handleDeletePasskey = async (credentialId) => {
        if (!(await confirm("정말 이 기기를 삭제하시겠습니까?", {title: "기기 삭제", confirmText: "삭제", danger: true}))) return;
        try {
            await axios.delete(`/api/passkeys/${credentialId}`, getAuthHeader());
            notify("삭제되었습니다.", {icon: '✅'});
            await fetchPasskeys(user.id);
        } catch (err) {
            notify("삭제 실패: " + err.message, {icon: '⚠️'});
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.reload();
    };

    // ---------------------------------------------------------
    // [4] 렌더링 (Render)
    // ---------------------------------------------------------
    return (
        <div className="ep-container" style={{position: 'relative'}}>
            <div style={{position: 'absolute', top: '20px', right: '20px', zIndex: 1000}}>
                <ThemeToggle/>
            </div>

            <style>
                {`
                .ep-container { display: flex; justify-content: center; align-items: center; width: 100%; min-height: 100vh; padding: 20px; box-sizing: border-box; background-color: var(--bg-color, #f4f6f8); transition: background-color 0.3s ease; }
                
                .ep-card { background-color: var(--card-bg, white); padding: 30px 25px; border-radius: var(--radius-lg); box-shadow: 0 10px 30px rgba(0,0,0,0.08); width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 20px; border: 1px solid var(--border-color, transparent); box-sizing: border-box; }
                .ep-header { margin: 0; text-align: center; color: var(--text-primary, #333); font-size: 1.6rem; }
                .ep-desc { text-align: center; color: var(--text-secondary, #666); font-size: 0.95rem; margin-bottom: 10px; line-height: 1.4; }
                
                .ep-row { display: flex; flex-direction: column; gap: 8px; width: 100%; }
                .ep-label { font-size: 0.9rem; color: var(--text-secondary, #666); font-weight: bold; }
                .ep-input { padding: 14px; border-radius: var(--radius-md); border: 1px solid var(--border-color, #ddd); font-size: 1rem; background-color: var(--bg-color, #f9f9f9); color: var(--text-primary, #333); outline: none; box-sizing: border-box; width: 100%; -webkit-appearance: none; }
                .ep-input:focus { border-color: #007bff; }
                
                .btn-link { padding: 14px; background-color: transparent; color: #007bff; border: 1px solid #007bff; border-radius: var(--radius-md); cursor: pointer; font-weight: bold; font-size: 1rem; text-align: center; transition: background-color 0.2s; width: 100%; box-sizing: border-box; }
                .btn-link:active { background-color: rgba(0,123,255,0.1); }
                
                .divider { margin: 5px 0; border: none; border-top: 1px solid var(--border-color, #eee); }
                
                .passkey-header { display: flex; justify-content: space-between; align-items: center; }
                .passkey-title { margin: 0; font-size: 1.1rem; color: var(--text-primary, #333); font-weight: bold; }
                .btn-add { padding: 8px 15px; background-color: #007bff; color: white; border: none; border-radius: var(--radius-sm); cursor: pointer; font-size: 0.85rem; font-weight: bold; }
                
                .passkey-list { background-color: var(--bg-color, #f8f9fa); border-radius: var(--radius-md); padding: 15px; border: 1px solid var(--border-color, #eee); max-height: 250px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
                .passkey-item { display: flex; justify-content: space-between; align-items: center; padding: 12px; background-color: var(--card-bg, white); border-radius: var(--radius-md); border: 1px solid var(--border-color, #eee); }
                .pk-name { font-weight: bold; color: var(--text-primary, #333); font-size: 1rem; margin-bottom: 4px; }
                .pk-date { font-size: 0.8rem; color: var(--text-secondary, #888); }
                .btn-del { padding: 8px 12px; background-color: #ffebee; color: #dc3545; border: none; border-radius: var(--radius-sm); cursor: pointer; font-size: 0.85rem; font-weight: bold; transition: background-color 0.2s; }
                
                .footer-btns { display: flex; justify-content: space-between; gap: 10px; margin-top: 10px; }
                .btn-base { flex: 1; padding: 14px; border: none; border-radius: var(--radius-md); cursor: pointer; font-weight: bold; font-size: 1rem; text-align: center; color: white; transition: transform 0.1s; }
                .btn-base:active { transform: scale(0.97); }
                .btn-back { background-color: #6c757d; } .btn-logout { background-color: #dc3545; } .btn-save { background-color: #007bff; }

                /* 다크모드 오버라이드 */
                [data-theme='dark'] .btn-link { color: #4facfe; border-color: #4facfe; }
                [data-theme='dark'] .btn-link:active { background-color: rgba(79, 172, 254, 0.1); }
                [data-theme='dark'] .btn-del { background-color: rgba(220, 53, 69, 0.2); color: #ff8a80; }
                `}
            </style>

            <div className="ep-card">
                {isChangingPassword ? (
                    // 1. 비밀번호 변경 화면
                    <>
                        <h2 className="ep-header">🔒 비밀번호 변경</h2>
                        <p className="ep-desc">안전한 계정 사용을 위해<br/>새로운 비밀번호를 입력해주세요.</p>
                        <div className="ep-row" style={{gap: '12px', margin: '15px 0'}}>
                            <input type="password" placeholder="현재 비밀번호" value={pwForm.currentPassword}
                                   onChange={(e) => setPwForm({...pwForm, currentPassword: e.target.value})}
                                   className="ep-input"/>
                            <input type="password" placeholder="새 비밀번호" value={pwForm.newPassword}
                                   onChange={(e) => setPwForm({...pwForm, newPassword: e.target.value})}
                                   className="ep-input" autoComplete="new-password"/>
                            <input type="password" placeholder="새 비밀번호 확인" value={pwForm.confirmPassword}
                                   onChange={(e) => setPwForm({...pwForm, confirmPassword: e.target.value})}
                                   className="ep-input" autoComplete="new-password"/>
                        </div>
                        <div className="footer-btns">
                            <button onClick={() => setIsChangingPassword(false)} className="btn-base btn-back">취소
                            </button>
                            <button onClick={handleChangePassword} className="btn-base btn-save">변경 저장</button>
                        </div>
                    </>
                ) : (
                    // 2. 메인 내 정보 화면
                    <>
                        <h2 className="ep-header">⚙️ 내 정보 수정</h2>
                        <div className="ep-row">
                            <label className="ep-label">아이디</label>
                            <input type="text" value={user.username} disabled className="ep-input"/>
                        </div>
                        <div className="ep-row">
                            <label className="ep-label">이름</label>
                            <input type="text" value={user.name} disabled className="ep-input"/>
                        </div>
                        <button onClick={() => setIsChangingPassword(true)} className="btn-link">비밀번호 변경하기 〉</button>

                        <hr className="divider"/>

                        <div className="passkey-header">
                            <h3 className="passkey-title">🔐 패스키 관리</h3>
                            <button onClick={handleRegisterPasskey} className="btn-add">+ 기기 등록</button>
                        </div>
                        <div className="passkey-list">
                            {passkeys.length === 0 ? (
                                <p style={{
                                    textAlign: 'center',
                                    color: 'var(--text-secondary)',
                                    padding: '20px 0',
                                    margin: 0
                                }}>등록된 기기가 없습니다.</p>
                            ) : (
                                passkeys.map((key) => (
                                    <div key={key.id} className="passkey-item">
                                        <div>
                                            <div className="pk-name">{key['device_name']}</div>
                                            <div
                                                className="pk-date">{new Date(key.created_at).toLocaleDateString()}</div>
                                        </div>
                                        <button onClick={() => handleDeletePasskey(key.id)} className="btn-del">삭제
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="footer-btns">
                            <button onClick={onBack} className="btn-base btn-back">뒤로 가기</button>
                            <button onClick={handleLogout} className="btn-base btn-logout">로그아웃</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default EditProfile;