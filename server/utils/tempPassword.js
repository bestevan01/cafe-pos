const crypto = require('crypto');

// 관리자가 발급해 직원에게 구두·메신저로 전달하는 임시 비밀번호를 만든다.
// 옮겨 적다 틀리는 일이 없도록 헷갈리는 글자(l, o, i)를 뺀 자음·모음 조합으로 만들고,
// 하이픈으로 끊어 읽기 쉽게 한다.
//
// 결과 예: 'mabu-keso-tirn-73'
// 비밀번호 정책(8자 이상 + 영문 + 숫자 + 특수문자)을 항상 만족한다.
//   - 영문: 자모 조합
//   - 숫자: 마지막 두 자리
//   - 특수문자: 하이픈
const CONSONANTS = 'bcdfghjkmnprstvwz'; // l 제외(1과 혼동)
const VOWELS = 'aeu'; // i, o 제외(1, 0과 혼동)

/** @param {string} chars */
const pick = (chars) => chars[crypto.randomInt(chars.length)];

/** 자음+모음+자음+모음 4글자 묶음 */
const syllable = () => pick(CONSONANTS) + pick(VOWELS) + pick(CONSONANTS) + pick(VOWELS);

/**
 * 임시 비밀번호 생성.
 * @returns {string}
 */
function generateTempPassword() {
    const groups = [syllable(), syllable(), syllable()];
    const digits = String(crypto.randomInt(10, 100)); // 10~99
    return `${groups.join('-')}-${digits}`;
}

module.exports = { generateTempPassword };
