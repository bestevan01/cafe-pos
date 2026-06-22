// 비밀번호 정책(서버측 강제). 프론트(src/utils/passwordPolicy.js)와 규칙을 동일하게 유지할 것.
// 클라이언트 검증을 우회한 직접 API 호출도 차단한다.
function isStrongPassword(pw) {
    return typeof pw === 'string'
        && pw.length >= 8
        && /[A-Za-z]/.test(pw)   // 영문 포함
        && /[0-9]/.test(pw)      // 숫자 포함
        && /[^A-Za-z0-9]/.test(pw); // 특수문자 포함
}

const PASSWORD_POLICY_MESSAGE = '비밀번호는 8자 이상이며 영문·숫자·특수문자를 모두 포함해야 합니다.';

module.exports = {isStrongPassword, PASSWORD_POLICY_MESSAGE};
