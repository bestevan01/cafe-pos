import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useNotification } from '../hooks/useNotification';
import {
    permission,
    pushEnvironment,
    currentSubscription,
    subscribePush,
    unsubscribePush,
    browserInfo,
    deniedSteps,
} from '../utils/browserNotify';

/**
 * 이 기기에서 알림을 받을지 정하는 부분.
 *
 * 각자 개인 기기를 쓰기 때문에 환경이 제각각이다 — PC 크롬, 갤럭시 탭 크롬, 아이패드 사파리…
 * 안 되는 이유를 '지원하지 않습니다' 한 줄로 뭉개면 사용자는 뭘 해야 할지 알 수 없다.
 * 그래서 걸린 사람에게는 그 사람에게 맞는 다음 행동만 보여준다.
 *
 * 알림을 쓰는 다른 기능이 생겨도 이 컴포넌트를 그대로 쓴다.
 */

/** 이유별로 '무엇을 하면 되는지'. 안내가 길어도 단계가 보이는 편이 낫다. */
const GUIDES = /** @type {Record<string, {title: string, steps: string[], fixable: boolean}>} */ ({
    'ios-home-screen': {
        title: 'iPhone·iPad는 홈 화면에 추가해야 합니다',
        steps: [
            '사파리 아래쪽 공유 버튼(□↑)을 누릅니다',
            '목록에서 「홈 화면에 추가」를 누릅니다',
            '홈 화면에 생긴 아이콘으로 앱을 엽니다',
            '이 화면에서 「알림 켜기」를 누릅니다',
        ],
        fixable: true,
    },
    'ios-wrong-browser': {
        title: 'iPhone·iPad에서는 사파리로 열어야 합니다',
        steps: ['사파리로 같은 주소를 엽니다', '공유 버튼 → 「홈 화면에 추가」', '생긴 아이콘으로 열어 알림을 켭니다'],
        fixable: true,
    },
    // denied는 브라우저마다 경로가 완전히 달라서 여기 고정 문구를 두지 않는다.
    // deniedSteps()가 지금 쓰는 브라우저에 맞는 순서를 준다.
    insecure: {
        title: 'https 주소로 접속해야 합니다',
        steps: ['주소창이 http로 시작하는지 확인합니다', '관리자에게 올바른 주소를 문의해주세요'],
        fixable: true,
    },
    unsupported: {
        title: '이 브라우저는 백그라운드 알림을 지원하지 않습니다',
        steps: ['크롬, 삼성 인터넷, 엣지 중 하나로 열어주세요'],
        fixable: true,
    },
});

/** 갤럭시 등 안드로이드에서만 필요한 추가 안내. 기능은 되는데 기기가 늦추는 경우다. */
const isAndroid = () => typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent);

function PushSetup() {
    const { notify } = useNotification();
    const [pushOn, setPushOn] = useState(false);
    const [busy, setBusy] = useState(false);
    const [perm, setPerm] = useState(permission());
    const [openTips, setOpenTips] = useState(false);
    const env = pushEnvironment();

    const authCfg = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

    /** browserNotify가 서버를 부를 때 쓰는 통로. 토큰은 여기서 붙인다. */
    const api = async (/** @type {string} */ path, /** @type {any} */ body) => {
        const res = body === undefined ? await axios.get(path, authCfg()) : await axios.post(path, body, authCfg());
        return res.data;
    };

    const refresh = useCallback(async () => {
        const sub = await currentSubscription();
        if (!sub) return setPushOn(false);
        try {
            // 브라우저에는 구독이 남아 있는데 서버에 없을 수 있다(다른 기기에서 정리했거나 DB를 비웠거나).
            const res = await axios.post('/api/push/status', { endpoint: sub.endpoint }, authCfg());
            setPushOn(Boolean(res.data?.registered));
        } catch {
            setPushOn(false);
        }
    }, []);

    useEffect(() => {
        // refresh는 await 뒤에야 setState한다(구독 조회 → 서버 확인). effect 본문의 동기 setState가 아니라 규칙 오탐.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void refresh();
    }, [refresh]);

    const enable = async () => {
        setBusy(true);
        try {
            const r = await subscribePush(api);
            if (r.ok) {
                setPerm(permission());
                await refresh();
                notify('이제 탭을 닫아도 알림을 받습니다.', { icon: '🔔' });
            } else {
                setPerm(permission());
                notify(r.advice || '알림 창에서 허용을 눌러주세요.', { icon: '🔕', duration: 0 });
            }
        } catch {
            notify('알림을 켜지 못했습니다.', { icon: '⚠️' });
        } finally {
            setBusy(false);
        }
    };

    const disable = async () => {
        setBusy(true);
        try {
            await unsubscribePush(api);
            setPushOn(false);
            notify('이 기기에서 알림을 껐습니다.', { icon: '🔕' });
        } finally {
            setBusy(false);
        }
    };

    // 차단된 경우는 브라우저별 경로를 그때그때 만든다. 나머지는 고정 안내.
    const guide = env.ok
        ? null
        : env.reason === 'denied'
          ? { title: `${browserInfo().name}이(가) 알림을 막고 있습니다`, steps: deniedSteps() }
          : GUIDES[env.reason];

    return (
        <div className="ps-wrap">
            <style>{`
                .ps-wrap { display: flex; flex-direction: column; gap: 14px; }
                .ps-state { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 14px; border-radius: 12px; background: var(--bg-color, #f7f7f7); }
                .ps-state.on { background: var(--success-bg); }
                .ps-text { flex: 1; min-width: 180px; display: flex; flex-direction: column; gap: 3px; }
                .ps-title { font-size: .98rem; font-weight: 800; color: var(--text-primary, #222); }
                .ps-state.on .ps-title { color: var(--success); }
                .ps-sub { font-size: .8rem; color: var(--text-secondary, #888); line-height: 1.55; word-break: keep-all; }
                .ps-btn { padding: 11px 18px; font-size: .92rem; font-weight: 700; border: none; border-radius: 10px; background: var(--accent, #1a73e8); color: #fff; cursor: pointer; font-family: inherit; }
                .ps-btn.ghost { background: none; border: 1px solid var(--border-color, #ddd); color: var(--text-secondary, #888); }
                .ps-btn:disabled { opacity: .5; cursor: default; }

                .ps-guide { padding: 14px; border-radius: 12px; border: 1px solid var(--warning); background: var(--warning-bg); }
                .ps-guide-title { margin: 0 0 8px; font-size: .92rem; font-weight: 800; color: var(--text-primary, #333); word-break: keep-all; }
                .ps-steps { margin: 0; padding-left: 20px; color: var(--text-primary, #444); font-size: .86rem; line-height: 1.85; word-break: keep-all; }

                .ps-tips { border: 1px solid var(--border-color, #eee); border-radius: 12px; overflow: hidden; }
                .ps-tips-head { width: 100%; padding: 12px 14px; background: none; border: none; text-align: left; font-family: inherit; font-size: .88rem; font-weight: 700; color: var(--text-primary, #444); cursor: pointer; }
                .ps-tips-body { padding: 0 14px 14px; margin: 0; padding-left: 34px; font-size: .84rem; line-height: 1.85; color: var(--text-secondary, #777); word-break: keep-all; }
            `}</style>

            <div className={`ps-state ${pushOn ? 'on' : ''}`}>
                <span className="ps-text">
                    <span className="ps-title">
                        {pushOn ? '🔔 탭을 닫아도 알림을 받습니다' : '🔕 이 기기는 알림이 꺼져 있습니다'}
                    </span>
                    <span className="ps-sub">
                        {pushOn
                            ? '브라우저를 닫아둬도 알림이 옵니다. 기기마다 따로 켜야 하니, 쓰시는 기기가 여럿이면 각각에서 켜주세요.'
                            : env.ok
                              ? '아래 버튼을 누르면 브라우저가 알림 허용을 물어봅니다.'
                              : '이 기기에서는 바로 켤 수 없습니다. 아래 안내를 따라주세요.'}
                    </span>
                </span>
                {pushOn ? (
                    <button className="ps-btn ghost" onClick={disable} disabled={busy}>
                        {busy ? '처리 중…' : '알림 끄기'}
                    </button>
                ) : (
                    env.ok && (
                        <button className="ps-btn" onClick={enable} disabled={busy}>
                            {busy ? '처리 중…' : '알림 켜기'}
                        </button>
                    )
                )}
            </div>

            {guide && (
                <div className="ps-guide">
                    <p className="ps-guide-title">⚠️ {guide.title}</p>
                    <ol className="ps-steps">
                        {guide.steps.map((step, i) => (
                            <li key={i}>{step}</li>
                        ))}
                    </ol>
                </div>
            )}

            {/* 안드로이드는 켜도 기기가 알림을 늦추는 일이 있다. 코드로는 못 고치고 설정으로만 된다. */}
            {isAndroid() && (
                <div className="ps-tips">
                    <button className="ps-tips-head" onClick={() => setOpenTips(!openTips)}>
                        {openTips ? '▾' : '▸'} 갤럭시·안드로이드에서 알림이 늦게 오면
                    </button>
                    {openTips && (
                        <ol className="ps-tips-body">
                            <li>설정 → 배터리 → 절전 모드를 끕니다</li>
                            <li>설정 → 배터리 → 백그라운드 사용 제한 → 「사용 안 함 앱」에서 브라우저를 뺍니다</li>
                            <li>최근 앱 목록에서 브라우저를 밀어 닫지 않습니다(닫으면 알림이 끊깁니다)</li>
                        </ol>
                    )}
                </div>
            )}

            {perm === 'granted' && !pushOn && env.ok && (
                <p className="ps-sub">
                    알림 권한은 허용돼 있지만 이 기기가 아직 등록되지 않았습니다. 「알림 켜기」를 눌러주세요.
                </p>
            )}
        </div>
    );
}

export default PushSetup;
