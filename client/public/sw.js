// @ts-check

/*
 * 서비스 워커 — 탭이 닫혀 있어도 알림을 받기 위한 것.
 *
 * 이 파일은 번들에 들어가지 않고 그대로 배포된다(public/). 브라우저가 앱과 별개로 돌린다.
 * 그래서 앱 코드의 import를 쓸 수 없고, 여기서 쓰는 것은 서비스 워커 전역뿐이다.
 *
 * 캐싱은 하지 않는다. 오프라인 지원이 목적이 아니라 알림만 받으면 되는데,
 * 어설프게 캐싱하면 배포 후에도 옛 화면이 남는 문제가 따라온다.
 *
 * ── 아래 타입 선언에 대해 ──
 * 이 파일은 client/jsconfig.json의 include 밖이라 에디터가 따로 검사하는데, 그때 기본값이
 * 일반 웹 페이지(DOM) 기준이다. 그래서 self를 Window로 보고 skipWaiting·clients가 없다고 한다.
 *
 * 흔한 해법 두 가지가 둘 다 안 맞았다.
 *  - `/// <reference lib="webworker" />` : DOM 타입과 정의가 겹쳐 수십 건의 충돌 오류가 난다
 *  - public/에 jsconfig를 따로 두기     : Vite가 public/을 통째로 배포하므로 설정 파일이 노출된다
 * 그래서 이 파일이 실제로 쓰는 것만 여기서 직접 선언한다. DOM 기준으로 열든 워커 기준으로
 * 열든 깨끗하게 통과한다.
 */

/**
 * @typedef {object} WorkerEvent
 * @property {(promise: Promise<unknown>) => void} waitUntil 이 작업이 끝날 때까지 워커를 살려둔다
 */

/**
 * @typedef {WorkerEvent & {data: {json(): any, text(): string} | null}} PushEvt
 */

/**
 * @typedef {WorkerEvent & {notification: Notification}} ClickEvt
 */

/**
 * @typedef {object} WindowClientLike
 * @property {() => Promise<unknown>} [focus]
 * @property {(message: unknown) => void} [postMessage]
 */

/**
 * @typedef {object} WorkerScope
 * @property {() => Promise<void>} skipWaiting
 * @property {ServiceWorkerRegistration} registration
 * @property {{
 *     claim(): Promise<void>,
 *     matchAll(options?: {type?: string, includeUncontrolled?: boolean}): Promise<WindowClientLike[]>,
 *     openWindow(url: string): Promise<unknown>,
 * }} clients
 * @property {(type: string, listener: (event: any) => void) => void} addEventListener
 */

/**
 * 서버가 보내는 알림 본문(server/utils/alerts.js의 payload와 같은 모양).
 * action은 알림을 눌렀을 때 앱이 열 화면의 이름이다(주소가 아니다 — 앱이 화면 상태로 이동하므로).
 * @typedef {{key?: string, title?: string, body?: string, action?: string|null}} AlertPayload
 */

const sw = /** @type {WorkerScope} */ (/** @type {unknown} */ (self));

// 새 워커를 곧바로 쓰게 한다. 기본 동작은 열려 있는 탭이 모두 닫힐 때까지 기다리는 것이라,
// 알림 형식을 고쳐도 한참 동안 옛 워커가 남는다.
sw.addEventListener('install', () => {
    void sw.skipWaiting();
});

sw.addEventListener(
    'activate',
    /** @param {WorkerEvent} event */ (event) => {
        event.waitUntil(sw.clients.claim());
    },
);

sw.addEventListener(
    'push',
    /** @param {PushEvt} event */ (event) => {
        /** @type {AlertPayload} */
        let data = {};
        try {
            data = event.data ? event.data.json() : {};
        } catch {
            data = { title: '알림', body: event.data ? event.data.text() : '' };
        }

        event.waitUntil(
            sw.registration.showNotification(data.title || '알림', {
                body: data.body || '',
                icon: '/logo.svg',
                badge: '/logo.svg',
                // 소켓으로 온 알림과 같은 태그라, 둘 다 도착해도 브라우저가 하나로 합친다.
                tag: data.key || 'app',
                // renotify는 표준 NotificationOptions 타입에 아직 없지만 크롬·엣지가 지원한다.
                // 같은 태그로 덮어써도 소리·진동을 다시 울리게 한다(안 그러면 두 번째부터 조용히 바뀐다).
                .../** @type {NotificationOptions} */ ({ renotify: true }),
                data: { action: data.action || null },
            }),
        );
    },
);

sw.addEventListener(
    'notificationclick',
    /** @param {ClickEvt} event */ (event) => {
        event.notification.close();
        /** @type {string|null} */
        const action = event.notification.data?.action || null;

        // 이미 열려 있는 탭이 있으면 그 탭을 앞으로 가져오고, 열 화면을 메시지로 알린다.
        // 누를 때마다 새 탭이 쌓이면 곤란하다.
        // 열린 탭이 없으면 새로 열되, 열 화면을 주소에 실어 보낸다 — 새 창은 아직 메시지를
        // 받을 준비가 안 됐으므로(browserNotify의 listenForAlertActions가 주소에서 읽는다).
        event.waitUntil(
            sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
                for (const client of list) {
                    if (typeof client.focus === 'function') {
                        if (action) client.postMessage?.({ type: 'alert_action', action });
                        return client.focus();
                    }
                }
                const target = action ? `/?alert_action=${encodeURIComponent(action)}` : '/';
                return sw.clients.openWindow(target);
            }),
        );
    },
);
