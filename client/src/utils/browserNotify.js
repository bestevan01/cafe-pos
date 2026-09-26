/**
 * 브라우저 알림 공통 코드.
 *
 * 특정 기능에 묶지 않는다. 서버가 'app_alert'로 {key, title, body}를 보내면 여기서 띄운다.
 *
 * ⚠️ 알아둘 한계: 서비스 워커가 없어서 **탭이 열려 있어야** 알림이 뜬다.
 * 그래서 이 알림은 '놓치지 않는 수단'이 아니라 '보고 있으면 빨리 알아채는 수단'이다.
 * 중요한 판단은 화면에서도 똑같이 보이게 만들어 두는 것이 원칙이다.
 *
 * 권한이 없거나 브라우저가 지원하지 않으면 false를 돌려준다 —
 * 부르는 쪽이 앱 안 토스트로 대신 보여주면 정보를 잃지 않는다.
 */

const STORAGE_KEY = 'browserAlertsOn';

// ============================================================
// 알림을 눌렀을 때 할 일 (공통)
// ============================================================
// 서버는 알림에 action 이름(예: 'open_inventory_count')을 실어 보낸다. 이 앱은 주소가 아니라
// 화면 상태로 이동하므로, 주소 대신 이름을 쓰고 실제로 무엇을 할지는 화면 쪽이 등록한다.
//
// 알림을 누르는 경로가 셋이라 모두 여기로 모은다.
//  1) 탭이 열려 있을 때 뜬 브라우저 알림        → Notification.onclick
//  2) 브라우저 알림이 막혀 대신 뜬 앱 안 토스트  → 토스트 onClick
//  3) 탭이 닫혀 있을 때 온 푸시 알림            → 서비스 워커가 창을 열며 전달
//
// 3)은 창이 새로 열리는 경우가 있어서, 화면이 아직 동작을 등록하기 전에 도착할 수 있다.
// 그래서 받을 곳이 없으면 잠시 맡아뒀다가 등록되는 순간 실행한다.

/** @type {Map<string, () => void>} */
const actionHandlers = new Map();
/** @type {{name: string, at: number}[]} 받을 곳이 등록되기 전에 도착한 동작 */
const pendingActions = [];

/**
 * 맡아둔 동작을 얼마나 기다릴지.
 * 맡아두는 이유는 푸시를 눌러 새 창이 뜨는 몇 초를 버티기 위해서다. 그보다 오래 기다리면
 * 엉뚱한 때에 화면이 열린다 — 로그아웃 중에 도착한 동작이 한참 뒤 다른 사람이 로그인하는
 * 순간 실행되는 식이다.
 */
const PENDING_TTL_MS = 15 * 1000;

/**
 * 알림을 눌렀을 때 할 일을 등록한다. 등록 해제 함수를 돌려준다(effect 정리용).
 * @param {string} name @param {() => void} handler
 */
export function registerAlertAction(name, handler) {
    actionHandlers.set(name, handler);
    // 먼저 도착해 기다리던 것이 있으면 지금 실행한다. 오래된 것은 버린다.
    const now = Date.now();
    let fresh = false;
    for (let i = pendingActions.length - 1; i >= 0; i--) {
        const p = pendingActions[i];
        if (now - p.at > PENDING_TTL_MS) {
            pendingActions.splice(i, 1);
        } else if (p.name === name) {
            pendingActions.splice(i, 1);
            fresh = true;
        }
    }
    if (fresh) handler(); // 같은 동작이 여러 번 맡겨져 있어도 화면은 한 번만 연다
    return () => {
        if (actionHandlers.get(name) === handler) actionHandlers.delete(name);
    };
}

/**
 * 동작을 실행한다. 받을 곳이 아직 없으면 맡아둔다.
 * 모르는 이름은 조용히 무시한다 — 서버가 새 동작을 먼저 배포하고 화면이 아직 옛 버전일 수 있다.
 * @param {string|null|undefined} name
 */
export function runAlertAction(name) {
    if (!name) return;
    const handler = actionHandlers.get(name);
    if (handler) handler();
    else if (!pendingActions.some((p) => p.name === name)) pendingActions.push({ name, at: Date.now() });
}

const ACTION_PARAM = 'alert_action';

/**
 * 알림으로 들어온 경로를 받는다. 앱이 켜질 때 한 번 부른다.
 *  - 서비스 워커가 창을 새로 열며 붙인 주소의 ?alert_action=
 *  - 이미 열린 탭으로 서비스 워커가 보낸 메시지
 * 주소의 흔적은 곧바로 지운다 — 남겨두면 새로고침할 때마다 같은 화면이 다시 열린다.
 */
export function listenForAlertActions() {
    if (typeof window === 'undefined') return () => {};

    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get(ACTION_PARAM);
    if (fromUrl) {
        url.searchParams.delete(ACTION_PARAM);
        window.history.replaceState(null, '', url.pathname + url.search + url.hash);
        runAlertAction(fromUrl);
    }

    if (!('serviceWorker' in navigator)) return () => {};
    /** @param {MessageEvent} e */
    const onMessage = (e) => {
        if (e.data?.type === ACTION_PARAM) runAlertAction(e.data.action);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
}

/** 이 브라우저가 알림을 지원하는가. 사파리 사생활 보호 모드 등에서 없을 수 있다. */
export const isSupported = () => typeof window !== 'undefined' && 'Notification' in window;

/** 'granted' | 'denied' | 'default' | 'unsupported' */
export function permission() {
    if (!isSupported()) return 'unsupported';
    return Notification.permission;
}

/**
 * 사용자가 이 기기에서 알림을 켜 뒀는가.
 * 권한과 별개로 둔다 — 권한은 줬지만 지금은 받기 싫을 수 있고, 그건 기기마다 다르다.
 * localStorage는 사파리 사생활 보호 모드에서 읽기만 해도 예외를 던지므로 감싼다.
 */
export function isEnabled() {
    if (permission() !== 'granted') return false;
    try {
        return localStorage.getItem(STORAGE_KEY) !== 'off';
    } catch {
        return true;
    }
}

/** @param {boolean} on */
export function setEnabled(on) {
    try {
        localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
        // 저장할 수 없어도 이번 세션 동작에는 지장이 없다.
    }
}

/**
 * 권한을 요청한다.
 * 브라우저는 사용자의 클릭 같은 동작 안에서만 이 창을 띄워준다 —
 * 화면이 뜨자마자 부르면 조용히 거부된다. 반드시 버튼 눌림에서 부를 것.
 * @returns {Promise<string>} 최종 권한 상태
 */
export async function requestPermission() {
    if (!isSupported()) return 'unsupported';
    if (Notification.permission === 'granted') {
        setEnabled(true);
        return 'granted';
    }
    // 한 번 거부하면 브라우저가 다시 묻지 않는다. 설정에서 직접 풀어야 한다.
    if (Notification.permission === 'denied') return 'denied';

    const result = await Notification.requestPermission();
    if (result === 'granted') setEnabled(true);
    return result;
}

/**
 * 알림을 띄운다.
 * @param {{key?: string, title: string, body?: string, action?: string|null}} alert
 * @returns {boolean} 띄웠으면 true. false면 부르는 쪽이 앱 안에서 대신 보여줘야 한다
 */
export function show(alert) {
    if (!isEnabled()) return false;
    try {
        const n = new Notification(alert.title, {
            body: alert.body,
            // 같은 종류의 알림이 쌓이지 않고 최신 것으로 덮인다.
            tag: alert.key ?? 'app',
            icon: '/logo.svg',
        });
        // 알림을 누르면 앱 창으로 돌아오고, 알림이 가리키는 화면을 연다.
        n.onclick = () => {
            window.focus();
            n.close();
            runAlertAction(alert.action);
        };
        return true;
    } catch {
        // 일부 브라우저는 권한이 있어도 특정 상황에서 생성을 거부한다.
        return false;
    }
}

// ============================================================
// 웹 푸시 — 탭을 닫아도 받기
// ============================================================
// 위쪽(show)은 탭이 열려 있을 때 소켓으로 받은 것을 띄운다. 아래쪽은 서비스 워커를 등록해
// 탭이 닫혀 있어도 브라우저가 대신 받게 한다. 둘은 같은 tag를 써서 겹쳐도 하나로 합쳐진다.

const SW_PATH = '/sw.js';

/** 이 브라우저가 웹 푸시를 할 수 있는가. */
export const pushSupported = () =>
    typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;

/** iPadOS는 데스크톱 사파리인 척해서 UA만으로는 구분이 안 된다. 터치 지점 수로 가른다. */
function isIOS() {
    if (typeof window === 'undefined') return false;
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

/** 홈 화면 아이콘으로 열린 독립 앱 상태인가. iOS는 이때만 알림을 쓸 수 있다. */
function isStandalone() {
    if (typeof window === 'undefined') return false;
    return (
        window.matchMedia?.('(display-mode: standalone)').matches ||
        /** @type {any} */ (window.navigator).standalone === true
    );
}

/** iOS에서 사파리가 아닌 브라우저인가. 크롬·엣지·파이어폭스 모두 속은 웹킷이라 푸시를 못 쓴다. */
function isIOSNonSafari() {
    return isIOS() && /CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);
}

/**
 * 어떤 브라우저인지 가려낸다.
 *
 * 순서가 중요하다 — 엣지·삼성인터넷·크롬의 UA에는 모두 'Chrome'이 들어 있고,
 * 크롬 UA에는 'Safari'도 들어 있다. 좁은 것부터 걸러야 한다.
 *
 * @returns {{id: string, name: string, platform: 'ios'|'android'|'desktop'}}
 */
export function browserInfo() {
    if (typeof navigator === 'undefined') return { id: 'other', name: '브라우저', platform: 'desktop' };
    const ua = navigator.userAgent;
    const platform = isIOS() ? 'ios' : /Android/.test(ua) ? 'android' : 'desktop';

    if (/EdgiOS|Edg\//.test(ua)) return { id: 'edge', name: '엣지', platform };
    if (/SamsungBrowser/.test(ua)) return { id: 'samsung', name: '삼성 인터넷', platform };
    if (/FxiOS|Firefox\//.test(ua)) return { id: 'firefox', name: '파이어폭스', platform };
    if (/CriOS|Chrome\//.test(ua)) return { id: 'chrome', name: '크롬', platform };
    if (/Safari\//.test(ua)) return { id: 'safari', name: '사파리', platform };
    return { id: 'other', name: '브라우저', platform };
}

/**
 * 알림이 차단됐을 때 푸는 방법. 브라우저마다 경로가 완전히 다르다.
 *
 * 한 벌로 뭉뚱그리면 안 된다 — 크롬은 주소창 자물쇠에서 풀지만, macOS 사파리는 주소창에
 * 그런 것이 없고 메뉴 막대의 설정으로 들어가야 한다. 맞지 않는 안내는 없는 것만 못하다.
 *
 * @returns {string[]}
 */
export function deniedSteps() {
    const { id, platform } = browserInfo();

    if (platform === 'ios') {
        // 홈 화면 앱은 iOS 설정 앱에서 관리한다. 사파리 안에는 해당 항목이 없다.
        return [
            'iPhone·iPad의 설정 앱을 엽니다',
            '목록을 내려 홈 화면에 추가한 앱(Cafe POS)을 찾습니다',
            '「알림」 → 「알림 허용」을 켭니다',
            '앱으로 돌아와 다시 시도합니다',
        ];
    }
    if (id === 'safari') {
        return [
            '화면 맨 위 메뉴 막대에서 Safari → 설정을 엽니다 (⌘ + ,)',
            '「웹사이트」 탭을 누르고 왼쪽 목록에서 「알림」을 고릅니다',
            '오른쪽 목록에서 이 사이트를 찾아 「허용」으로 바꿉니다',
            '페이지를 새로고침한 뒤 다시 켭니다',
        ];
    }
    if (id === 'firefox') {
        return [
            '주소창 왼쪽 자물쇠를 누릅니다',
            '「알림」 옆의 「차단됨」에서 ✕ 를 눌러 설정을 지웁니다',
            '페이지를 새로고침한 뒤 다시 켭니다',
        ];
    }
    if (id === 'samsung') {
        return [
            '주소창 왼쪽 자물쇠를 누릅니다',
            '「권한」 → 「알림」을 허용으로 바꿉니다',
            '페이지를 새로고침한 뒤 다시 켭니다',
        ];
    }
    if (id === 'edge') {
        return [
            '주소창 왼쪽 자물쇠를 누릅니다',
            '「이 사이트에 대한 권한」에서 「알림」을 허용으로 바꿉니다',
            '페이지를 새로고침한 뒤 다시 켭니다',
        ];
    }
    // 크롬 계열(안드로이드 포함)
    return platform === 'android'
        ? [
              '주소창 왼쪽 자물쇠를 누릅니다',
              '「권한」 → 「알림」을 허용으로 바꿉니다',
              '페이지를 새로고침한 뒤 다시 켭니다',
          ]
        : [
              '주소창 왼쪽의 아이콘(자물쇠 또는 ⚙︎ 모양)을 누릅니다',
              '「사이트 설정」을 열고 「알림」을 찾습니다',
              '「허용」으로 바꾸고 페이지를 새로고침합니다',
          ];
}

/**
 * 이 기기에서 '탭을 닫아도 받기'가 가능한지 진단한다.
 *
 * 환경이 제각각이라(PC 크롬, 갤럭시 탭 크롬, 아이패드 사파리, 삼성 인터넷…) 안 되는 이유를
 * 뭉뚱그리면 사용자가 뭘 해야 할지 알 수 없다. 이유별로 할 일을 정확히 짚어준다.
 *
 * @returns {{ok: boolean, reason: string, advice: string}}
 */
export function pushEnvironment() {
    if (typeof window === 'undefined') return { ok: false, reason: 'no-window', advice: '' };

    // 보안 컨텍스트가 아니면 서비스 워커 자체가 등록되지 않는다(localhost는 예외).
    if (!window.isSecureContext) {
        return {
            ok: false,
            reason: 'insecure',
            advice: 'https 주소로 접속해야 알림을 쓸 수 있습니다. 주소창을 확인해주세요.',
        };
    }
    if (isIOSNonSafari()) {
        return {
            ok: false,
            reason: 'ios-wrong-browser',
            advice: 'iPhone·iPad에서는 사파리로 열어야 알림을 쓸 수 있습니다. 크롬을 포함한 다른 브라우저는 애플 제약으로 불가합니다.',
        };
    }
    if (isIOS() && !isStandalone()) {
        return {
            ok: false,
            reason: 'ios-home-screen',
            advice: '사파리 아래 공유 버튼 → 홈 화면에 추가를 누른 뒤, 생긴 아이콘으로 열어서 다시 시도해주세요.',
        };
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return {
            ok: false,
            reason: 'unsupported',
            advice: '이 브라우저는 백그라운드 알림을 지원하지 않습니다. 크롬이나 삼성 인터넷으로 열어주세요.',
        };
    }
    if (permission() === 'denied') {
        return {
            ok: false,
            reason: 'denied',
            // 구체적인 경로는 deniedSteps()가 브라우저별로 알려준다.
            advice: `${browserInfo().name}이(가) 알림을 막고 있습니다. 아래 순서대로 풀어주세요.`,
        };
    }
    return { ok: true, reason: 'ok', advice: '' };
}

/** 예전 이름. 화면에서 iOS 안내만 필요할 때 쓴다. */
export const iosNeedsHomeScreen = () => isIOS() && !isStandalone();

/** VAPID 공개키는 base64url 문자열로 오는데, 구독 API는 Uint8Array를 받는다. @param {string} base64 */
function urlBase64ToUint8Array(base64) {
    const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(padded);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** 서비스 워커를 등록하고 준비될 때까지 기다린다. */
async function ready() {
    await navigator.serviceWorker.register(SW_PATH);
    return navigator.serviceWorker.ready;
}

/** 지금 이 기기의 구독. 없으면 null. */
export async function currentSubscription() {
    if (!pushSupported()) return null;
    try {
        const reg = await ready();
        return await reg.pushManager.getSubscription();
    } catch {
        return null;
    }
}

/**
 * 이 기기를 푸시 대상으로 등록한다.
 * 권한 요청을 포함하므로 반드시 버튼 눌림 안에서 부를 것.
 * @param {(path: string, body?: any) => Promise<any>} api 서버 호출(토큰은 부르는 쪽이 붙인다)
 * @returns {Promise<{ok: boolean, reason?: string, advice?: string}>}
 */
export async function subscribePush(api) {
    const env = pushEnvironment();
    if (!env.ok) return { ok: false, reason: env.reason, advice: env.advice };

    const perm = await requestPermission();
    if (perm !== 'granted') return { ok: false, reason: perm };

    const keyRes = await api('/api/push/key').catch(() => null);
    if (!keyRes?.key) return { ok: false, reason: 'not-configured' };

    const reg = await ready();
    // 이미 구독이 있으면 그대로 쓴다. 다시 만들면 endpoint가 바뀌어 서버에 죽은 행이 남는다.
    const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
            userVisibleOnly: true, // 조용한 푸시는 브라우저가 허용하지 않는다
            applicationServerKey: urlBase64ToUint8Array(keyRes.key),
        }));

    await api('/api/push/subscribe', { subscription: sub.toJSON() });
    setEnabled(true);
    return { ok: true };
}

/**
 * 이 기기를 푸시 대상에서 뺀다.
 * @param {(path: string, body?: any) => Promise<any>} api
 */
export async function unsubscribePush(api) {
    const sub = await currentSubscription();
    if (!sub) return;
    await api('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => null);
    await sub.unsubscribe().catch(() => null);
}
