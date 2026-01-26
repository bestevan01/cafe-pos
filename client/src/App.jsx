import { useState, useEffect } from 'react';
import { socket } from './socket';
import OnePersonMode from './OnePersonMode';
import Kitchen from './Kitchen';
import RoleSelection from './RoleSelection';

function App() {
    const [userCount, setUserCount] = useState(0);
    const [myRole, setMyRole] = useState(null); // 'cashier' | 'kitchen' | null
    const [isCashierTaken, setIsCashierTaken] = useState(false);

    useEffect(() => {
        let disconnectTimer; // ⏳ 타이머를 저장할 변수 (새로고침 방어용)

        socket.on('user_count', (count) => {
            setUserCount(count);

            // ✅ [스마트 전환 로직]
            // 혼자가 되었을 때(count <= 1), 바로 역할을 풀지 않고 "3초" 기다립니다.
            if (count <= 1) {
                // 혹시 기존에 돌고 있던 타이머가 있다면 끄고 다시 시작 (중복 방지)
                if (disconnectTimer) clearTimeout(disconnectTimer);

                disconnectTimer = setTimeout(() => {
                    // 3초 뒤에도 여전히 혼자라면?
                    // -> 이건 진짜 상대방이 퇴근한 것이므로 통합 모드로 복귀!
                    setMyRole(null);
                }, 3000);
            }
            // 다시 2명 이상이 되었다면? (상대방이 새로고침해서 금방 돌아온 경우)
            else {
                // "아, 다시 왔네? 취소!" -> 타이머 해제하고 현재 화면 유지
                if (disconnectTimer) clearTimeout(disconnectTimer);
            }
        });

        // 캐셔 자리 선점 상태 확인
        socket.on('cashier_status', (isTaken) => {
            setIsCashierTaken(isTaken);
        });

        // 접속하자마자 "현재 몇 명이고, 상태는 어떤가요?" 라고 먼저 물어보기
        socket.emit('request_state');

        return () => {
            socket.off('user_count');
            socket.off('cashier_status');
            // 컴포넌트가 꺼질 때 타이머도 같이 정리
            if (disconnectTimer) clearTimeout(disconnectTimer);
        };
    }, []);

    // 1️⃣ 내가 이미 역할을 골랐다면? -> 접속자 수 변동(새로고침)에 흔들리지 않고 화면 유지
    if (myRole === 'cashier') {
        return <OnePersonMode onlyOrder={false} />;
    }

    if (myRole === 'kitchen') {
        return <Kitchen />;
    }

    // 2️⃣ 역할이 없을 때만 인원수 체크
    // 혼자 있으면(그리고 3초가 지나서 myRole이 초기화됐다면) -> 자동 통합 모드
    if (userCount <= 1) {
        return <OnePersonMode />;
    }

    // 3️⃣ 여럿인데 아직 역할을 안 골랐을 때 -> 선택 화면 (캐셔 상태 전달)
    return (
        <RoleSelection
            onSelectRole={(role) => setMyRole(role)}
            isCashierTaken={isCashierTaken}
        />
    );
}

export default App;