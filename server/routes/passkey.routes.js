const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { authenticateToken } = require('../middlewares/auth');
const debugInfo = require('../utils/debugInfo');
const { issueToken, consumeToken } = require('../utils/ephemeralTokens');
const { aaguidToProviderName } = require('../utils/aaguidNames');
const {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const JWT_SECRET = /** @type {string} */ (process.env.JWT_SECRET);
const FRONTEND_URL = process.env.FRONTEND_URL || 'bu-cafe-pos.vercel.app';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const RP_ID = IS_PRODUCTION ? FRONTEND_URL : 'localhost';
const EXPECTED_ORIGIN = IS_PRODUCTION ? `https://${FRONTEND_URL}` : 'http://localhost:5173';

// 제공자(AAGUID)를 알 수 없는 '기기 전용' 패스키(보안키 등) 폴백용: User-Agent로 기기/브라우저 추정.
// ⚠️ iOS UA엔 'Mac OS X'가 들어있어 iPhone/iPad를 Mac보다 먼저, Edge/Chrome도 더 구체적인 것부터 검사한다.
/** @param {string|undefined} userAgent */
function uaDeviceName(userAgent) {
    // User-Agent 헤더가 없는 요청(일부 클라이언트/프록시)에서도 죽지 않도록 방어
    if (!userAgent) return '기타 기기';
    let name = '기타 기기';
    if (userAgent.includes('iPhone')) name = 'iPhone';
    else if (userAgent.includes('iPad')) name = 'iPad';
    else if (userAgent.includes('Android')) name = 'Android';
    else if (userAgent.includes('Windows')) name = 'Windows PC';
    else if (userAgent.includes('Mac')) name = 'Mac';
    else if (userAgent.includes('Linux')) name = 'Linux';
    if (userAgent.includes('Edg')) name += ' (Edge)';
    else if (userAgent.includes('Chrome')) name += ' (Chrome)';
    else if (userAgent.includes('Firefox')) name += ' (Firefox)';
    else if (userAgent.includes('Safari')) name += ' (Safari)';
    return name;
}

router.get('/passkey/register-options', authenticateToken, async (req, res) => {
    const userId = req.user.id; // 인증된 본인 계정에만 등록 옵션 생성 (클라이언트 userId 신뢰 안 함)

    try {
        const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
        const [userPasskeys] = await pool.query('SELECT id, transports FROM passkeys WHERE user_id = ?', [userId]);

        if (users.length === 0) return res.status(400).json({ error: 'User not found' });
        const user = users[0];

        const options = await generateRegistrationOptions({
            rpName: 'Cafe POS',
            rpID: RP_ID,
            userID: new Uint8Array(Buffer.from(String(user.id))),
            userName: user.username,
            excludeCredentials: userPasskeys.map((/** @type {any} */ key) => ({
                id: key.id,
                transports: key.transports ? key.transports.split(',') : [],
            })),
            authenticatorSelection: {
                residentKey: 'required', // Conditional UI(자동완성) 노출을 위해 discoverable 보장
                userVerification: 'required', // 생체/PIN 검증 강제
                authenticatorAttachment: 'platform',
            },
        });

        // 등록용 챌린지를 사용자별 키로 저장(5분). 같은 유저가 다시 요청하면 갱신됨.
        await issueToken('webauthn_register', 5 * 60, {
            token: `webauthn_register:${userId}`,
            payload: options.challenge,
        });

        res.json(options);
    } catch (/** @type {any} */ err) {
        console.error(`[🔥 GET /api/passkey/register-options 에러] 대상 유저 ID: ${userId}`, err);
        res.status(500).json({
            success: false,
            message: '패스키 등록 옵션 생성에 실패했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

router.post('/passkey/register-verify', authenticateToken, async (req, res) => {
    const userId = req.user.id; // 인증된 본인 계정에만 패스키 등록
    const { body } = req.body;

    try {
        // 사용자별 등록 챌린지를 1회용으로 소비
        const consumed = await consumeToken(`webauthn_register:${userId}`, 'webauthn_register');
        if (!consumed) {
            return res.status(400).json({ error: 'Challenge not found' });
        }

        const verification = await verifyRegistrationResponse({
            response: body,
            expectedChallenge: String(consumed.payload),
            expectedOrigin: EXPECTED_ORIGIN,
            expectedRPID: RP_ID,
        });

        if (verification.verified && verification.registrationInfo) {
            const { credential, aaguid, credentialDeviceType } = verification.registrationInfo;
            // 패스키 이름: 제공자(AAGUID) > 동기화 여부 > 등록 기기(UA) 순으로 의미 있는 이름을 정한다.
            // 패스키는 기기가 아니라 제공자(iCloud 키체인 등)에 저장·동기화되므로 제공자명이 가장 정확하다.
            let deviceName = aaguidToProviderName(aaguid);
            if (!deviceName) {
                deviceName =
                    credentialDeviceType === 'multiDevice'
                        ? '동기화 패스키' // 제공자 미상이지만 여러 기기에 동기화되는 패스키
                        : uaDeviceName(req.get('User-Agent') || ''); // 보안키 등 기기 전용 → 등록 기기로 표기
            }

            await pool.query(
                `INSERT INTO passkeys (id, public_key, counter, user_id, transports, device_name)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    String(credential.id),
                    Buffer.from(credential.publicKey).toString('base64'),
                    credential.counter,
                    userId,
                    'internal',
                    deviceName,
                ],
            );

            res.json({ success: true });
        } else {
            res.status(400).json({ success: false, message: '패스키 검증에 실패했습니다.' });
        }
    } catch (/** @type {any} */ error) {
        console.error(`[🔥 POST /api/passkey/register-verify 에러] 대상 유저 ID: ${userId}`, error);
        res.status(500).json({
            success: false,
            message: '패스키 등록 검증 중 서버 오류가 발생했습니다.',
            debug_info: debugInfo(error),
        });
    }
});

router.get('/passkey/login-options', async (req, res) => {
    try {
        const options = await generateAuthenticationOptions({
            rpID: RP_ID,
            userVerification: 'required',
        });
        // 로그인용 챌린지 저장(15분). 메모리 대신 DB → 재시작에도 생존.
        await issueToken('webauthn_login', 15 * 60, { token: options.challenge });
        res.json(options);
    } catch (/** @type {any} */ err) {
        console.error('[🔥 GET /api/passkey/login-options 에러]', err);
        res.status(500).json({
            success: false,
            message: '패스키 로그인 옵션 생성에 실패했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

router.post('/passkey/login-verify', async (req, res) => {
    const { body } = req.body;

    try {
        const [rows] = await pool.query('SELECT * FROM passkeys WHERE id = ?', [body.id]);
        if (rows.length === 0) {
            return res.status(400).json({ error: 'Passkey not found' });
        }

        const passkey = rows[0];
        const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [passkey['user_id']]);

        const user = users[0];
        const verification = await verifyAuthenticationResponse({
            response: body,
            // 챌린지를 DB에서 1회용으로 소비(원자적). 동시/재전송 replay 방지.
            expectedChallenge: async (challenge) => (await consumeToken(challenge, 'webauthn_login')) !== null,
            expectedOrigin: EXPECTED_ORIGIN,
            expectedRPID: RP_ID,
            credential: {
                id: passkey.id,
                publicKey: new Uint8Array(Buffer.from(passkey['public_key'], 'base64')),
                counter: Number(passkey.counter),
                transports: passkey.transports ? passkey.transports.split(',') : [],
            },
            requireUserVerification: true,
        });

        if (verification.verified) {
            await pool.query('UPDATE passkeys SET counter = ? WHERE id = ?', [
                verification.authenticationInfo.newCounter,
                passkey.id,
            ]);

            if (user.role === 'pending') {
                return res.status(403).json({ success: false, message: '승인 대기 중입니다.' });
            }

            const token = jwt.sign(
                {
                    id: user.id,
                    username: user.username,
                    role: user.role,
                    name: user.name,
                },
                JWT_SECRET,
                { expiresIn: '12h' },
            );
            res.json({ success: true, token, role: user.role, name: user.name, username: user.username, id: user.id });
        } else {
            res.status(400).json({ success: false, message: '패스키 로그인 검증에 실패했습니다.' });
        }
    } catch (/** @type {any} */ error) {
        console.error('[🔥 POST /api/passkey/login-verify 에러]', error);
        res.status(400).json({
            success: false,
            message: '로그인 검증 중 오류가 발생했습니다.',
            debug_info: debugInfo(error),
        });
    }
});

router.get('/passkeys', authenticateToken, async (req, res) => {
    const userId = req.user.id; // 본인 패스키 목록만 조회
    try {
        const [rows] = await pool.query(
            'SELECT id, device_name, created_at FROM passkeys WHERE user_id = ? ORDER BY created_at DESC',
            [userId],
        );
        res.json(rows);
    } catch (/** @type {any} */ err) {
        console.error(`[🔥 GET /api/passkeys 에러] 대상 유저 ID: ${userId}`, err);
        res.status(500).json({
            success: false,
            message: '패스키 목록 조회에 실패했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

router.patch('/passkeys/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const name = (req.body.device_name || '').trim();
    if (!name || name.length > 50) {
        return res.status(400).json({ success: false, message: '이름은 1~50자로 입력해주세요.' });
    }
    try {
        // 본인 소유의 패스키만 이름 변경 가능
        const [result] = await pool.query('UPDATE passkeys SET device_name = ? WHERE id = ? AND user_id = ?', [
            name,
            id,
            req.user.id,
        ]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: '패스키를 찾을 수 없습니다.' });
        }
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        console.error(`[🔥 PATCH /api/passkeys/${id} 에러]`, err);
        res.status(500).json({
            success: false,
            message: '패스키 이름 변경에 실패했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

router.delete('/passkeys/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        // 본인 소유의 패스키만 삭제 가능
        const [result] = await pool.query('DELETE FROM passkeys WHERE id = ? AND user_id = ?', [id, req.user.id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: '삭제할 패스키를 찾을 수 없습니다.' });
        }
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        console.error(`[🔥 DELETE /api/passkeys/${id} 에러]`, err);
        res.status(500).json({
            success: false,
            message: '패스키 삭제에 실패했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

module.exports = router;
