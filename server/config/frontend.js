// 프론트엔드 출처(origin) 설정을 한곳에서 결정한다.
//
// FRONTEND_URL 하나가 CORS 허용 출처(server.js)와 패스키의 RP_ID/EXPECTED_ORIGIN
// (passkey.routes.js)을 모두 결정한다. 두 파일이 각자 process.env를 읽으면 값이
// 어긋났을 때 "로그인은 되는데 패스키만 안 되는" 식으로 증상이 갈라져 추적이 어렵다.
//
// ⚠️ 폴백 기본값을 두지 않는다.
// 매장(본부동/은혜관/테스트)마다 도메인이 달라 폴백은 하나만 가질 수 있는데,
// 어느 서버든 환경변수가 비면 다른 매장 도메인을 자기 출처로 믿게 되고
// CORS와 패스키가 동시에 깨지면서 원인이 드러나지 않는다.
// 잘못된 값으로 조용히 뜨는 것보다 기동을 멈추는 편이 안전하다.
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const RAW = process.env.FRONTEND_URL;

if (IS_PRODUCTION) {
    if (!RAW) {
        console.error(
            '🚨 FATAL: FRONTEND_URL이 설정되지 않았습니다.\n' +
                '   이 값은 CORS 허용 출처와 패스키 RP ID를 결정합니다.\n' +
                "   호스트명만 넣으세요 (예: 'bu-cafe-hq.pages.dev').",
        );
        process.exit(1);
    }
    if (/^https?:\/\//i.test(RAW)) {
        console.error(
            `🚨 FATAL: FRONTEND_URL에 스킴이 포함되어 있습니다 → '${RAW}'\n` +
                "   코드가 'https://' + FRONTEND_URL로 조합하므로 호스트명만 넣어야 합니다.\n" +
                "   (예: 'bu-cafe-hq.pages.dev')",
        );
        process.exit(1);
    }
}

/** 프론트엔드 호스트명 (스킴 없음). 개발 환경에서는 Vite 개발 서버. */
const FRONTEND_URL = IS_PRODUCTION ? /** @type {string} */ (RAW) : 'localhost:5173';

/** CORS 허용 출처 및 패스키 EXPECTED_ORIGIN */
const FRONTEND_ORIGIN = IS_PRODUCTION ? `https://${FRONTEND_URL}` : 'http://localhost:5173';

/** 패스키 RP ID — 포트를 포함하지 않는 순수 호스트명이어야 한다. */
const RP_ID = IS_PRODUCTION ? FRONTEND_URL : 'localhost';

module.exports = { FRONTEND_URL, FRONTEND_ORIGIN, RP_ID, IS_PRODUCTION };
