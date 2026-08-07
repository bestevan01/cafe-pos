const crypto = require('crypto');
const pool = require('../config/db');

/**
 * 단기·1회용 토큰 공용 저장소.
 * 메모리 전역 객체 대신 DB(ephemeral_tokens)에 저장 → 서버 재시작·스케일아웃에도 생존.
 * WebAuthn 챌린지를 비롯해 OTP·비밀번호 재설정·멱등키 등에 재사용 가능(purpose로 구분).
 */

// 만료된 행 정리. 별도 타이머 없이 issueToken에서 가끔 호출한다.
async function cleanupExpired() {
    try {
        await pool.query('DELETE FROM ephemeral_tokens WHERE expires_at < NOW()');
    } catch (/** @type {any} */ err) {
        console.error('[⚠️ ephemeral_tokens 정리 실패]', err.message);
    }
}

/**
 * 토큰 발급(저장). 같은 token이 있으면 갱신한다(ON DUPLICATE KEY UPDATE).
 * @param {string} purpose       용도 태그 (예: 'webauthn_login')
 * @param {number} ttlSeconds    유효 시간(초)
 * @param {{token?: string, payload?: string|null}} [opts]  token 미지정 시 랜덤 생성
 * @returns {Promise<string>}    발급된 token
 */
async function issueToken(purpose, ttlSeconds, { token, payload = null } = {}) {
    // noinspection JSCheckFunctionSignatures -- Buffer.toString(encoding)인데 WebStorm이 0-인자 toString으로 오인(정상 코드)
    const tok = token || crypto.randomBytes(32).toString('base64url');
    await pool.query(
        `INSERT INTO ephemeral_tokens (token, purpose, payload, expires_at)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))
         ON DUPLICATE KEY UPDATE purpose    = VALUES(purpose),
                                 payload    = VALUES(payload),
                                 expires_at = VALUES(expires_at)`,
        [tok, purpose, payload, ttlSeconds],
    );
    if (Math.random() < 0.05) void cleanupExpired(); // 가끔 만료분 청소(타이머 불필요)
    return tok;
}

/**
 * 토큰을 1회용으로 소비한다. 유효하면 삭제 후 {payload} 반환, 없으면 null.
 * 원자적 DELETE(affectedRows)로 동시 요청에도 한 번만 성공시킨다(replay 방지).
 * @param {string} token
 * @param {string} purpose
 * @returns {Promise<{payload: string|null} | null>}
 */
async function consumeToken(token, purpose) {
    if (!token) return null;
    // payload가 필요한 경우(등록 챌린지 등)를 위해 먼저 읽는다.
    const [rows] = await pool.query(
        'SELECT payload FROM ephemeral_tokens WHERE token = ? AND purpose = ? AND expires_at > NOW()',
        [token, purpose],
    );
    // 실제로 '내 DELETE'가 행을 지웠을 때만 성공으로 인정 → 1회용 보장.
    const [del] = await pool.query(
        'DELETE FROM ephemeral_tokens WHERE token = ? AND purpose = ? AND expires_at > NOW()',
        [token, purpose],
    );
    if (del.affectedRows !== 1) return null;
    return { payload: rows.length ? rows[0].payload : null };
}

module.exports = { issueToken, consumeToken };
