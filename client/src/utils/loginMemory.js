// 마지막으로 성공한 로그인 수단을 기억해, 다음 방문 때 패스키를 자동으로 띄울지 정한다.
//
// 브라우저는 "이 기기에 패스키가 저장돼 있는지"를 사이트에 알려주지 않는다.
// W3C 명세가 크리덴셜의 속성은 물론 '존재 여부'조차 노출하지 못하게 막고 있어서,
// isUVPAA()나 getClientCapabilities()로도 알 수 없다(기기·브라우저 지원 여부만 알려준다).
// 그래서 감지 대신 '기억'으로 대신한다 — 직전에 패스키로 들어왔다면 이 기기에 패스키가
// 있다는 뜻이므로, 그 사실을 우리가 직접 적어 두고 다음 방문 때 읽는다.
//
// 자동 호출 자체는 Safari 16.0+ / Chrome 모두 사용자 제스처 없이 허용된다.
// (그 이전 Safari는 제스처를 요구했지만, 매장 기기는 모두 그보다 훨씬 최신이다)

const LAST_METHOD_KEY = 'lastLoginMethod';
const SKIP_AUTO_KEY = 'skipAutoPasskey';

// localStorage/sessionStorage는 사파리 프라이빗 모드 등에서 접근만 해도 던진다.
// 실패해도 '자동 호출을 못 할 뿐' 로그인 자체에는 영향이 없으므로 전부 삼킨다.

/**
 * 직전에 성공한 로그인 수단을 읽는다.
 * @returns {string|null} 'passkey' | 'password' | null(기록 없음)
 */
export function readLastMethod() {
    try {
        return localStorage.getItem(LAST_METHOD_KEY);
    } catch {
        return null;
    }
}

/**
 * 로그인 성공 시 수단을 기록한다.
 * @param {'password'|'passkey'|null} method  null이면 기억을 지운다(자동 호출 중단)
 */
export function writeLastMethod(method) {
    try {
        if (method) localStorage.setItem(LAST_METHOD_KEY, method);
        else localStorage.removeItem(LAST_METHOD_KEY);
    } catch {
        /* 저장 실패는 무시 */
    }
}

/**
 * 다음 로그인 화면에서 자동 패스키 호출을 한 번 건너뛰게 한다.
 *
 * 직접 로그아웃했다면 교대 등으로 다른 사람이 쓸 수 있다. 공용 단말에서 다음 사람에게
 * 이전 사용자의 FaceID 창을 들이미는 상황을 막는다. 반대로 자동(1시간 무활동)·세션만료
 * 로그아웃은 같은 사람이 돌아오는 상황이라 건너뛰지 않는다 — 오히려 그때가 자동 호출이
 * 가장 요긴한 순간이다.
 *
 * sessionStorage라 탭을 닫으면 사라진다. 즉 '이 탭에서 방금 로그아웃함'만 뜻한다.
 */
export function suppressAutoPasskeyOnce() {
    try {
        sessionStorage.setItem(SKIP_AUTO_KEY, '1');
    } catch {
        /* 저장 실패는 무시 */
    }
}

/**
 * 건너뛰기 표시를 읽고 즉시 지운다(1회용).
 * @returns {boolean} true면 이번 한 번은 자동 호출하지 않는다
 */
export function consumeSkipAuto() {
    try {
        const skip = sessionStorage.getItem(SKIP_AUTO_KEY) === '1';
        sessionStorage.removeItem(SKIP_AUTO_KEY);
        return skip;
    } catch {
        return false;
    }
}
