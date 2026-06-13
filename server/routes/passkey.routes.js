const express = require('express')
const router = express.Router();
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const {authenticateToken} = require("../middlewares/auth");
const debugInfo = require("../utils/debugInfo");
const {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse
} = require('@simplewebauthn/server');

const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_URL = 'bu-cafe-pos.vercel.app';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const currentChallenges = {}; // 챌린지 임시 저장소
const RP_ID = IS_PRODUCTION ? FRONTEND_URL : 'localhost';
const EXPECTED_ORIGIN = IS_PRODUCTION ? `https://${FRONTEND_URL}` : 'http://localhost:5173';

router.get('/passkey/register-options', authenticateToken, async (req, res) => {
    const userId = req.user.id; // 인증된 본인 계정에만 등록 옵션 생성 (클라이언트 userId 신뢰 안 함)

    try {
        const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
        const [userPasskeys] = await pool.query('SELECT id, transports FROM passkeys WHERE user_id = ?', [userId]);

        if (users.length === 0) return res.status(400).json({error: 'User not found'});
        const user = users[0];

        const options = await generateRegistrationOptions({
            rpName: 'Cafe POS',
            rpID: RP_ID,
            userID: new Uint8Array(Buffer.from(String(user.id))),
            userName: user.username,
            excludeCredentials: userPasskeys.map(key => ({
                id: key.id,
                transports: key.transports ? key.transports.split(',') : []
            })),
            authenticatorSelection: {
                residentKey: 'preferred',
                userVerification: 'preferred',
                authenticatorAttachment: 'platform'
            },
        });

        currentChallenges[userId] = options.challenge;
        // 5분 후 챌린지 자동 삭제 (메모리 관리)
        setTimeout(() => {
            if (currentChallenges[userId]) delete currentChallenges[userId];
        }, 5 * 60 * 1000);

        res.json(options);
    } catch (err) {
        console.error(`[🔥 GET /api/passkey/register-options 에러] 대상 유저 ID: ${userId}`, err);
        res.status(500).json({
            success: false,
            message: '패스키 등록 옵션 생성에 실패했습니다.',
            debug_info: debugInfo(err)
        });
    }
});

router.post('/passkey/register-verify', authenticateToken, async (req, res) => {
    const userId = req.user.id; // 인증된 본인 계정에만 패스키 등록
    const {body} = req.body;
    const expectedChallenge = currentChallenges[userId];

    if (!expectedChallenge) {
        return res.status(400).json({error: 'Challenge not found'});
    }

    try {
        const verification = await verifyRegistrationResponse({
            response: body,
            expectedChallenge,
            expectedOrigin: EXPECTED_ORIGIN,
            expectedRPID: RP_ID,
        });

        if (verification.verified && verification.registrationInfo) {
            const {credential} = verification.registrationInfo;
            // 기기 이름 추정 로직
            const userAgent = req.get('User-Agent') || '';
            let deviceName = '기타 기기';
            if (userAgent.includes('Mac')) deviceName = 'Mac';
            else if (userAgent.includes('Windows')) deviceName = 'Windows PC';
            else if (userAgent.includes('iPhone')) deviceName = 'iPhone';
            else if (userAgent.includes('Android')) deviceName = 'Android';
            else if (userAgent.includes('Linux')) deviceName = 'Linux';

            if (userAgent.includes('Chrome')) deviceName += ' (Chrome)';
            else if (userAgent.includes('Safari')) deviceName += ' (Safari)';
            else if (userAgent.includes('Edg')) deviceName += ' (Edge)';
            else if (userAgent.includes('Firefox')) deviceName += ' (Firefox)';

            await pool.query(
                `INSERT INTO passkeys (id, public_key, counter, user_id, transports, device_name)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    String(credential.id),
                    Buffer.from(credential.publicKey).toString('base64'),
                    credential.counter,
                    userId,
                    'internal',
                    deviceName
                ]
            );

            delete currentChallenges[userId];
            res.json({success: true});
        } else {
            res.status(400).json({success: false, message: '패스키 검증에 실패했습니다.'});
        }
    } catch (error) {
        console.error(`[🔥 POST /api/passkey/register-verify 에러] 대상 유저 ID: ${userId}`, error);
        res.status(500).json({
            success: false,
            message: '패스키 등록 검증 중 서버 오류가 발생했습니다.',
            debug_info: debugInfo(error)
        });
    }
});

router.get('/passkey/login-options', async (req, res) => {
    try {
        const options = await generateAuthenticationOptions({
            rpID: RP_ID,
            userVerification: 'preferred',
        });
        currentChallenges[options.challenge] = options.challenge;
        res.json(options);
    } catch (err) {
        console.error('[🔥 GET /api/passkey/login-options 에러]', err);
        res.status(500).json({
            success: false,
            message: '패스키 로그인 옵션 생성에 실패했습니다.',
            debug_info: debugInfo(err)
        });
    }
});

router.post('/passkey/login-verify', async (req, res) => {
    const {body} = req.body;

    try {
        const [rows] = await pool.query('SELECT * FROM passkeys WHERE id = ?', [body.id]);
        if (rows.length === 0) {
            return res.status(400).json({error: 'Passkey not found'});
        }

        const passkey = rows[0];
        const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [passkey['user_id']]);

        const user = users[0];
        const verification = await verifyAuthenticationResponse({
            response: body,
            expectedChallenge: (challenge) => {
                if (currentChallenges[challenge]) {
                    delete currentChallenges[challenge];
                    return true;
                }
                return false;
            },
            expectedOrigin: EXPECTED_ORIGIN,
            expectedRPID: RP_ID,
            credential: {
                id: passkey.id,
                publicKey: new Uint8Array(Buffer.from(passkey['public_key'], 'base64')),
                counter: Number(passkey.counter),
                transports: passkey.transports ? passkey.transports.split(',') : [],
            },
            requireUserVerification: false,
        });

        if (verification.verified) {
            await pool.query('UPDATE passkeys SET counter = ? WHERE id = ?', [verification.authenticationInfo.newCounter, passkey.id]);

            const token = jwt.sign({
                id: user.id,
                username: user.username,
                role: user.role,
                name: user.name
            }, JWT_SECRET, {expiresIn: '12h'});
            res.json({success: true, token, role: user.role, name: user.name, username: user.username, id: user.id});
        } else {
            res.status(400).json({success: false, message: '패스키 로그인 검증에 실패했습니다.'});
        }
    } catch (error) {
        console.error('[🔥 POST /api/passkey/login-verify 에러]', error);
        res.status(400).json({
            success: false,
            message: '로그인 검증 중 오류가 발생했습니다.',
            debug_info: debugInfo(error)
        });
    }
});

router.get('/passkeys', authenticateToken, async (req, res) => {
    const userId = req.user.id; // 본인 패스키 목록만 조회
    try {
        const [rows] = await pool.query(
            'SELECT id, device_name, created_at FROM passkeys WHERE user_id = ? ORDER BY created_at DESC',
            [userId]
        );
        res.json(rows);
    } catch (err) {
        console.error(`[🔥 GET /api/passkeys 에러] 대상 유저 ID: ${userId}`, err);
        res.status(500).json({
            success: false,
            message: '패스키 목록 조회에 실패했습니다.',
            debug_info: debugInfo(err)
        });
    }
});

router.delete('/passkeys/:id', authenticateToken, async (req, res) => {
    const {id} = req.params;
    try {
        // 본인 소유의 패스키만 삭제 가능
        const [result] = await pool.query('DELETE FROM passkeys WHERE id = ? AND user_id = ?', [id, req.user.id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({success: false, message: '삭제할 패스키를 찾을 수 없습니다.'});
        }
        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 DELETE /api/passkeys/${id} 에러]`, err);
        res.status(500).json({
            success: false,
            message: '패스키 삭제에 실패했습니다.',
            debug_info: debugInfo(err)
        });
    }
});

module.exports = router;