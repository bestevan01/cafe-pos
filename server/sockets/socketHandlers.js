let currentCashierId = null;
const connectedUsers = new Map();
const kitchenUsers = new Set();

module.exports = (io) => {
    io.on('connection', (socket) => {
        console.log(`[🟢 Socket 연결됨] ID: ${socket.id} (현재 접속자: ${io.engine.clientsCount}명)`);

        socket.on('register_user', (data) => {
            connectedUsers.set(socket.id, data);
            console.log(`[👤 유저 등록] ${data.username} (ID: ${socket.id})`);
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