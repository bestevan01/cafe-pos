const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

// ⚠️ 아래 실시간 상태는 의도적으로 '단일 인스턴스' 인메모리다.
//  - 현 배포(Render 단일 인스턴스 + Node 단일 스레드)에서 안전: 이벤트 핸들러가 직렬 실행되어
//    claim_cashier의 check-then-set 사이에 await가 없어 경쟁이 없다. 끊김 시 자동 해제,
//    꼬임 시 force_release_cashier(관리자)로 복구, 서버 재시작 시 모든 소켓이 끊겨 null이 정상.
//  - 스케일아웃(인스턴스 ≥ 2) 시: 이 상태를 공유(Redis/DB)해야 하고 + io.emit이 인스턴스를 넘도록
//    Socket.IO Redis 어댑터가 필요하다. 어댑터 없이 DB로만 옮기면 브로드캐스트가 안 넘어가 무의미하므로,
//    단일 인스턴스인 지금은 인메모리가 정답이라 그대로 둔다. (레이트리밋·챌린지만 DB화한 것과 동일 판단)
let currentCashierId = null;
const connectedUsers = new Map();
const kitchenUsers = new Set();

module.exports = (io) => {
    // 핸드셰이크 단계에서 JWT를 검증해야만 소켓 연결을 허용합니다.
    io.use((socket, next) => {
        // 인증 실패 에러에는 type:'auth' 표시를 달아, 클라이언트가
        // 일시적 네트워크 오류와 구분해 '재로그인'을 유도할 수 있게 한다.
        const authError = (message) => {
            const err = new Error(message);
            err.data = {type: 'auth'};
            return err;
        };

        const token = socket.handshake.auth && socket.handshake.auth.token;
        if (!token) return next(authError('인증 토큰이 없습니다.'));

        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) return next(authError('유효하지 않은 토큰입니다.'));
            socket.data.user = user; // 검증된 신원을 소켓에 저장
            next();
        });
    });

    io.on('connection', (socket) => {
        console.log(`[🟢 Socket 연결됨] ID: ${socket.id} (현재 접속자: ${io.engine.clientsCount}명)`);

        socket.on('register_user', () => {
            // 클라이언트가 보낸 값이 아닌, 핸드셰이크에서 검증된 신원만 신뢰합니다.
            const user = socket.data.user;
            connectedUsers.set(socket.id, {username: user.username, role: user.role});
            console.log(`[👤 유저 등록] ${user.username} (ID: ${socket.id})`);
            broadcastUserCount();
        });

        socket.on('claim_cashier', () => {
            if (currentCashierId === null) {
                currentCashierId = socket.id;
                console.log(`[🛒 캐셔 선점] ID: ${socket.id}`);
                io.emit('cashier_status', true);
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
                io.emit('cashier_status', false);
            }
        });

        // 데드 스위치: 잠금이 꼬여 아무도 캐셔로 접속하지 못할 때 관리자가 강제 해제.
        // 소켓 ID와 무관하게 currentCashierId를 비운다. (관리자 전용)
        socket.on('force_release_cashier', (ack) => {
            if (socket.data.user?.role !== 'admin') {
                if (typeof ack === 'function') ack({success: false, message: '관리자 권한이 필요합니다.'});
                return;
            }
            currentCashierId = null;
            console.log(`[🚨 캐셔 강제 해제] 관리자: ${socket.data.user.username}`);
            io.emit('cashier_status', false);
            if (typeof ack === 'function') ack({success: true});
        });

        socket.on('request_state', () => {
            socket.emit('cashier_status', currentCashierId !== null);
            socket.emit('kitchen_status', kitchenUsers.size > 0);
        });

        socket.on('join_kitchen', () => {
            kitchenUsers.add(socket.id);
            io.emit('kitchen_status', kitchenUsers.size > 0);
            console.log(`[🍳 주방 입장] ID: ${socket.id} (현재 주방 인원: ${kitchenUsers.size}명)`);
        });

        socket.on('leave_kitchen', () => {
            kitchenUsers.delete(socket.id);
            io.emit('kitchen_status', kitchenUsers.size > 0);
        });

        socket.on('logout', () => {
            const user = connectedUsers.get(socket.id);
            console.log(`[👋 로그아웃] ${user?.username || '알 수 없음'} (ID: ${socket.id})`);
            connectedUsers.delete(socket.id);
            broadcastUserCount();
        });

        socket.on('disconnect', (reason) => {
            console.log(`[🔴 Socket 끊김] ID: ${socket.id}, 사유: ${reason}`);

            connectedUsers.delete(socket.id);
            broadcastUserCount();

            if (socket.id === currentCashierId) {
                currentCashierId = null;
                console.log(`[🔓 캐셔 자동 해제] 사유: 캐셔 담당자의 연결 끊김`);
                io.emit('cashier_status', false);
            }

            if (kitchenUsers.has(socket.id)) {
                kitchenUsers.delete(socket.id);
                io.emit('kitchen_status', kitchenUsers.size > 0);
                console.log(`[🍳 주방 퇴장 (연결 끊김)] 남은 주방 인원: ${kitchenUsers.size}명`);
            }
        });

        socket.on('error', (err) => {
            console.error(`[❌ Socket 에러] ID: ${socket.id}, 에러 상세:`, err);
        });

        function broadcastUserCount() {
            const staffUsers = Array.from(connectedUsers.values()).filter(user => user.role !== 'admin');
            const uniqueStaffCount = new Set(staffUsers.map(u => u.username)).size;
            io.emit('user_count', uniqueStaffCount);
        }
    });
};