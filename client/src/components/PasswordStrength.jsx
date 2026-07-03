import { PASSWORD_RULES } from '../utils/passwordPolicy';

/**
 * 비밀번호 입력 시 정책 충족 여부를 실시간으로 시각화한다.
 * - 각 규칙(길이/영문/숫자/특수문자)을 ✓/○ 로 표시
 * - confirmPassword가 주어지면 위 비밀번호와 일치 여부도 실시간 표시
 *
 * @param {string} password
 * @param {string} [confirmPassword]  주어지고 1자 이상 입력됐을 때만 일치 표시
 */
function PasswordStrength({ password = '', confirmPassword }) {
    // 규칙 체크리스트는 항상 표시. 재입력 일치 여부는 확인칸에 무언가 입력됐을 때만 표시.
    const showMatch = confirmPassword != null && confirmPassword.length > 0;
    const matched = password.length > 0 && password === confirmPassword;

    return (
        <div className="pw-strength">
            <style>
                {`
                .pw-strength { width: 100%; display: flex; flex-direction: column; gap: 6px; }
                .pw-rules { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 4px 14px; }
                .pw-rules li { display: flex; align-items: center; gap: 5px; font-size: var(--fs-xs, 0.78rem); color: var(--text-secondary, #999); transition: color 0.15s ease; }
                .pw-rules li.ok { color: var(--success, #28a745); }
                .pw-mark { width: 1em; text-align: center; font-weight: bold; }
                .pw-match { font-size: var(--fs-xs, 0.78rem); font-weight: bold; }
                .pw-match.ok { color: var(--success, #28a745); }
                .pw-match.bad { color: var(--danger, #dc3545); }
                `}
            </style>

            <ul className="pw-rules">
                {PASSWORD_RULES.map((r) => {
                    const passed = r.test(password);
                    return (
                        <li key={r.key} className={passed ? 'ok' : ''}>
                            <span className="pw-mark">{passed ? '✓' : '○'}</span>
                            {r.label}
                        </li>
                    );
                })}
            </ul>

            {showMatch && (
                <div className={`pw-match ${matched ? 'ok' : 'bad'}`}>
                    {matched ? '✓ 비밀번호가 일치합니다' : '✗ 비밀번호가 일치하지 않습니다'}
                </div>
            )}
        </div>
    );
}

export default PasswordStrength;
