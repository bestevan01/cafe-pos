import io from "socket.io-client";

const BACKEND_URL = import.meta.env['VITE_API_URL'] || 'http://localhost:8080';

export const socket = io(BACKEND_URL, {
    autoConnect: false, // 로그인 전에는 연결하지 않음
    // auth를 함수로 두면 (재)연결 시마다 최신 토큰을 다시 읽어 보냅니다.
    auth: (cb) => cb({token: localStorage.getItem('token')})
});