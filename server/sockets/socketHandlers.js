const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const JWT_SECRET = /** @type {string} */ (process.env.JWT_SECRET);

// ⚠️ 아래 실시간 상태는 의도적으로 '단일 인스턴스' 인메모리다.
//  - 현 배포(Render 단일 인스턴스 + Node 단일 스레드)에서 안전: 이벤트 핸들러가 직렬 실행되어
//    claim_cashier의 check-then-set 사이에 await가 없어 경쟁이 없다. 끊김 시 자동 해제,
//    꼬임 시 force_release_cashier(관리자)로 복구, 서버 재시작 시 모든 소켓이 끊겨 null이 정상.
//  - 스케일아웃(인스턴스 ≥ 2) 시: 이 상태를 공유(Redis/DB)해야 하고 + io.emit이 인스턴스를 넘도록
//    Socket.IO Redis 어댑터가 필요하다. 어댑터 없이 DB로만 옮기면 브로드캐스트가 안 넘어가 무의미하므로,
//    단일 인스턴스인 지금은 인메모리가 정답이라 그대로 둔다. (레이트리밋·챌린지만 DB화한 것과 동일 판단)
/** @type {string|null} */
let currentCashierId = null;
const connectedUsers = new Map();
const kitchenUsers = new Set();

/** @param {import('socket.io').Server} io */
module.exports = (io) => {
    // 핸드셰이크 단계에서 JWT를 검증해야만 소켓 연결을 허용합니다.
    io.use((socket, next) => {
        // 인증 실패 에러에는 type:'auth' 표시를 달아, 클라이언트가
        // 일시적 네트워크 오류와 구분해 '재로그인'을 유도할 수 있게 한다.
        /** @param {string} message */
        const authError = (message) => {
            const err = /** @type {Error & {data?: {type: string}}} */ (new Error(message));
            err.data = { type: 'auth' };
            return err;
        };

        const token = socket.handshake.auth && socket.handshake.auth.token;
        if (!token) return next(authError('인증 토큰이 없습니다.'));

        jwt.verify(token, JWT_SECRET, async (/** @type {any} */ err, /** @type {any} */ payload) => {
            if (err) return next(authError('유효하지 않은 토큰입니다.'));
            try {
                // HTTP와 같은 이유로 DB를 확인한다. 서명만 보면 계정이 지워졌거나 권한이
                // 바뀐 사실을 알 수 없다(자세한 배경은 middlewares/auth.js 주석 참고).
                const [rows] = await pool.query('SELECT id, username, name, role FROM users WHERE id = ?', [
                    payload.id,
                ]);
                if (rows.length === 0) return next(authError('계정을 찾을 수 없습니다.'));
                if (rows[0].role === 'pending') return next(authError('승인 대기 상태입니다.'));
                socket.data.user = rows[0]; // 지금 DB 기준의 신원을 저장
                next();
            } catch (/** @type {any} */ dbErr) {
                // DB 문제로 연결을 끊되, 인증 실패로는 표시하지 않는다.
                // type:'auth'를 달면 클라이언트가 재로그인을 요구해 버린다.
                console.error('[🔥 소켓 인증 중 DB 조회 실패]', dbErr.message);
                return next(new Error('일시적인 오류입니다.'));
            }
        });
    });

    // 현재 캐셔 점유 상태 + 점유자 이름을 함께 담아 반환 (RoleSelection에 "OOO님 사용 중" 표시용)
    function cashierStatusPayload() {
        const ownerSocket = currentCashierId ? io.sockets.sockets.get(currentCashierId) : null;
        return { taken: currentCashierId !== null, name: ownerSocket?.data?.user?.name || null };
    }

    io.on('connection', (socket) => {
        console.log(`[🟢 Socket 연결됨] ID: ${socket.id} (현재 접속자: ${io.engine.clientsCount}명)`);

        socket.on('register_user', () => {
            // 클라이언트가 보낸 값이 아닌, 핸드셰이크에서 검증된 신원만 신뢰합니다.
            const user = socket.data.user;
            connectedUsers.set(socket.id, { username: user.username, role: user.role });
            console.log(`[👤 유저 등록] ${user.username} (ID: ${socket.id})`);
            broadcastUserCount();
        });

        socket.on('claim_cashier', () => {
            // 관리자는 1인 제한 예외: 다른 직원이 이미 캐셔를 쓰고 있어도 항상 진입 허용.
            // 단, currentCashierId(점유 락)는 건드리지 않는다 — 관리자가 나가도 실제 담당 직원의
            // 자리가 반납되면 안 되고, 관리자 자신도 release_cashier 시 잘못 반납시키지 않기 위함.
            if (socket.data.user?.role === 'admin') {
                console.log(`[🛒 캐셔 진입(관리자, 1인 제한 예외)] ID: ${socket.id}`);
                socket.emit('cashier_claimed', true);
                return;
            }

            // 재선점 허용 조건: 자리가 비었거나, 본인 소켓이 소유자거나,
            // 소유자가 같은 계정의 이전 연결(순단 후 아직 타임아웃 안 된 좀비 소켓)인 경우.
            // 좀비 소켓의 disconnect가 늦게 도착해도 release 가드(socket.id 비교)에 걸려 새 소유권을 해치지 않는다.
            const ownerSocket = currentCashierId ? io.sockets.sockets.get(currentCashierId) : null;
            const isSameUser = ownerSocket?.data?.user?.username === socket.data.user?.username;

            if (currentCashierId === null || currentCashierId === socket.id || !ownerSocket || isSameUser) {
                currentCashierId = socket.id;
                console.log(`[🛒 캐셔 선점] ID: ${socket.id}`);
                io.emit('cashier_status', cashierStatusPayload());
                socket.emit('cashier_claimed', true);
            } else {
                console.log(`[⚠️ 캐셔 선점 실패] ID: ${socket.id} (이미 사용 중)`);
                socket.emit('cashier_claimed', false);
            }
        });

        socket.on('release_cashier', () => {
            if (socket.id === currentCashierId) {
                currentCashierId = null;
                console.log(`[🔓 캐셔 해제] ID: ${socket.id}가 캐셔 자리를 반납함`);
                io.emit('cashier_status', cashierStatusPayload());
            }
        });

        // 데드 스위치: 잠금이 꼬여 아무도 캐셔로 접속하지 못할 때 관리자가 강제 해제.
        // 소켓 ID와 무관하게 currentCashierId를 비운다. (관리자 전용)
        socket.on('force_release_cashier', (/** @type {any} */ ack) => {
            if (socket.data.user?.role !== 'admin') {
                if (typeof ack === 'function') ack({ success: false, message: '관리자 권한이 필요합니다.' });
                return;
            }
            currentCashierId = null;
            console.log(`[🚨 캐셔 강제 해제] 관리자: ${socket.data.user.username}`);
            io.emit('cashier_status', cashierStatusPayload());
            if (typeof ack === 'function') ack({ success: true });
        });

        socket.on('request_state', () => {
            socket.emit('cashier_status', cashierStatusPayload());
            socket.emit('kitchen_status', kitchenUsers.size);
        });

        socket.on('join_kitchen', () => {
            // 관리자는 user_count와 마찬가지로 주방 접속자 카운트에서 제외(1인 제한 예외와 별개로, 통계성 카운트만 제외).
            if (socket.data.user?.role === 'admin') {
                console.log(`[🍳 주방 입장(관리자, 카운트 제외)] ID: ${socket.id}`);
                return;
            }
            kitchenUsers.add(socket.id);
            io.emit('kitchen_status', kitchenUsers.size);
            console.log(`[🍳 주방 입장] ID: ${socket.id} (현재 주방 인원: ${kitchenUsers.size}명)`);
        });

        socket.on('leave_kitchen', () => {
            kitchenUsers.delete(socket.id);
            io.emit('kitchen_status', kitchenUsers.size);
        });

        socket.on('logout', () => {
            const user = connectedUsers.get(socket.id);
            console.log(`[👋 로그아웃] ${user?.username || '알 수 없음'} (ID: ${socket.id})`);
            connectedUsers.delete(socket.id);
            broadcastUserCount();
        });

        socket.on('disconnect', (/** @type {string} */ reason) => {
            console.log(`[🔴 Socket 끊김] ID: ${socket.id}, 사유: ${reason}`);

            connectedUsers.delete(socket.id);
            broadcastUserCount();

            if (socket.id === currentCashierId) {
                currentCashierId = null;
                console.log(`[🔓 캐셔 자동 해제] 사유: 캐셔 담당자의 연결 끊김`);
                io.emit('cashier_status', cashierStatusPayload());
            }

            if (kitchenUsers.has(socket.id)) {
                kitchenUsers.delete(socket.id);
                io.emit('kitchen_status', kitchenUsers.size);
                console.log(`[🍳 주방 퇴장 (연결 끊김)] 남은 주방 인원: ${kitchenUsers.size}명`);
            }
        });

        socket.on('error', (/** @type {any} */ err) => {
            console.error(`[❌ Socket 에러] ID: ${socket.id}, 에러 상세:`, err);
        });

        function broadcastUserCount() {
            const staffUsers = Array.from(connectedUsers.values()).filter((user) => user.role !== 'admin');
            const uniqueStaffCount = new Set(staffUsers.map((u) => u.username)).size;
            io.emit('user_count', uniqueStaffCount);
        }
    });
};
