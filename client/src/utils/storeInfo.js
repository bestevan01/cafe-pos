// 접속 도메인으로 어느 매장인지 판별한다.
//
// 매장마다 백엔드와 DB가 완전히 분리돼 있어, 다른 매장 화면에서 주문을 받으면
// 매출·시재가 통째로 엉뚱한 장부에 들어가고 마감 때까지 아무도 모른다.
// 로그인 화면 상단 띠에 매장별 색을 깔아, 글씨를 읽지 않아도 구분되게 한다.
//
// 색은 흰색/크림 글자 기준 WCAG AA(4.5:1)를 통과하는 값만 쓴다.

/**
 * @typedef {object} StoreInfo
 * @property {string} label 띠에 표시할 문구
 * @property {string} bg 띠 배경색
 * @property {string} fg 띠 글자색
 */

/** @type {Record<string, StoreInfo>} */
const STORES = {
    // 본부동 — 브랜드 딥그린
    'bu-cafe-hq.pages.dev': { label: '본부동점', bg: '#165027', fg: '#FDF6DC' },
    // 은혜관 — 딥그린과 가장 헷갈리지 않는 다크브라운
    'bu-cafe-eunhye.pages.dev': { label: '은혜관점', bg: '#5C3A21', fg: '#FDF6DC' },
    // 테스트 — 운영과 화면이 똑같아 실수로 진짜 주문을 넣기 쉬우므로 경고색
    'bu-cafe-dev.pages.dev': { label: '테스트 서버 · 실제 주문 금지', bg: '#C62828', fg: '#FFFFFF' },

    // Cloudflare 이관 완료 후 제거할 구 Vercel 도메인
    'bu-cafe-pos.vercel.app': { label: '본부동점', bg: '#165027', fg: '#FDF6DC' },
    'bu-cafe-pos-beta.vercel.app': { label: '테스트 서버 · 실제 주문 금지', bg: '#C62828', fg: '#FFFFFF' },
};

/** @type {StoreInfo} */
const LOCAL = { label: '로컬 개발 환경', bg: '#455A64', fg: '#FFFFFF' };

/**
 * @param {string} [hostname] 기본값은 현재 접속 호스트
 * @returns {StoreInfo|null} 등록되지 않은 도메인이면 null.
 *   틀린 매장명을 띄우는 것보다 아무것도 안 띄우는 편이 안전하다.
 */
export function getStoreInfo(hostname = window.location.hostname) {
    if (hostname === 'localhost' || hostname === '127.0.0.1') return LOCAL;
    return STORES[hostname] ?? null;
}
