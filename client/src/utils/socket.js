import io from 'socket.io-client';

const BACKEND_URL = import.meta.env['VITE_API_URL'] || 'http://localhost:8080';

export const socket = io(BACKEND_URL, {
    autoConnect: false, // 로그인 전에는 연결하지 않음
    // auth를 함수로 두면 (재)연결 시마다 최신 토큰을 다시 읽어 보냅니다.
    auth: (cb) => cb({ token: localStorage.getItem('token') }),
});

/**
 * 끊겼다 돌아왔을 때 화면을 다시 맞춘다.
 *
 * 실시간 화면은 처음에 목록을 한 번 받고, 그 뒤로는 서버가 보내는 신호(new_order 등)로 고친다.
 * 그런데 연결이 끊긴 동안 온 신호는 서버가 다시 보내 주지 않는다. 휴대폰은 화면이 꺼지면
 * 연결이 끊기므로, 다시 켜면 연결은 복구돼도 그 사이의 주문이 목록에 없다(실제로 겪었다).
 *
 * 그래서 두 순간에 목록을 통째로 다시 받는다.
 *  - 소켓이 (다시) 연결됐을 때
 *  - 한동안 가려져 있던 화면이 다시 보일 때 — iPhone은 화면을 켠 직후 소켓이 끊긴 줄을
 *    한참 모른다. 연결 이벤트만 기다리면 그동안 빈 목록을 보게 된다.
 * 둘은 거의 같이 일어나므로 짧게 묶어 한 번만 부른다.
 *
 * @param {() => void} refresh  목록을 다시 받는 함수
 * @returns {() => void}  해제 함수(effect cleanup에서 부른다)
 */
export function onResync(refresh) {
    /** 이보다 짧게 가려졌다 돌아온 것(탭 잠깐 전환 등)은 무시한다. */
    const MIN_HIDDEN_MS = 3000;
    /** 연결 복구와 화면 복귀가 겹칠 때 한 번만 부르기 위한 간격. */
    const COALESCE_MS = 1000;

    let hiddenAt = document.visibilityState === 'hidden' ? Date.now() : null;
    let lastRun = 0;
    const run = () => {
        const now = Date.now();
        if (now - lastRun < COALESCE_MS) return;
        lastRun = now;
        refresh();
    };

    const onVisibility = () => {
        if (document.visibilityState === 'hidden') {
            hiddenAt = Date.now();
            return;
        }
        const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
        hiddenAt = null;
        if (away >= MIN_HIDDEN_MS) run();
    };

    socket.on('connect', run);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
        socket.off('connect', run);
        document.removeEventListener('visibilitychange', onVisibility);
    };
}
