// 비밀번호 정책: 회원가입 / 비밀번호 변경에서 공통으로 사용한다.
// 서버(server/utils/passwordPolicy.js)와 규칙을 동일하게 유지할 것.
/** @type {{key: string, label: string, test: (pw: string) => boolean}[]} */
export const PASSWORD_RULES = [
    { key: 'length', label: '8자 이상', test: (pw) => pw.length >= 8 },
    { key: 'letter', label: '영문 포함', test: (pw) => /[A-Za-z]/.test(pw) },
    { key: 'number', label: '숫자 포함', test: (pw) => /[0-9]/.test(pw) },
    { key: 'special', label: '특수문자 포함', test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

// 모든 규칙을 통과해야 강력한 비밀번호로 인정
export function isStrongPassword(pw = '') {
    return PASSWORD_RULES.every((r) => r.test(pw));
}
