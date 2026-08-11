// 어느 매장 화면인지 구분하는 정보. 빌드 시점 환경변수로 주입한다.
//
// 매장마다 백엔드와 DB가 완전히 분리돼 있어, 다른 매장 화면에서 주문을 받으면
// 매출·시재가 통째로 엉뚱한 장부에 들어가고 마감 때까지 아무도 모른다.
// 로그인 화면 상단 띠에 매장별 색을 깔아, 글씨를 읽지 않아도 구분되게 한다.
//
// 배포 환경마다 다음 값을 설정한다 (Cloudflare Pages는 Production·Preview 각각):
//   VITE_STORE_NAME   띠 문구            예) '본부동점'
//   VITE_STORE_COLOR  띠 배경색(hex)      예) '#165027'
//
// 글자색은 배경 밝기에서 자동으로 정한다. 설정값을 하나 줄이면서,
// 색을 잘못 넣어 글씨가 안 보이는 상태가 되는 것도 막는다.

/** 색이 없거나 해석할 수 없을 때 쓰는 중립색. 특정 매장 색을 흉내내지 않도록 회색 계열. */
const FALLBACK_BG = '#455a64';
const LIGHT_TEXT = '#FDF6DC'; // 브랜드 크림
const DARK_TEXT = '#1A1A1A';

/**
 * @typedef {object} StoreInfo
 * @property {string} label 띠에 표시할 문구
 * @property {string} bg 띠 배경색
 * @property {string} fg 띠 글자색
 */

/**
 * '#rrggbb' 형태로 정규화한다. hex가 아니면 null.
 * '#' 없는 값이나 3자리 축약형을 그대로 CSS에 넘기면 배경이 투명 처리되므로 여기서 걸러낸다.
 * @param {string} value
 * @returns {string|null}
 */
function normalizeHex(value) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
    if (!m) return null;
    const h = m[1].toLowerCase();
    return '#' + (h.length === 3 ? h.replace(/./g, (c) => c + c) : h);
}

/**
 * WCAG 상대 휘도.
 * @param {string} hex '#rrggbb'로 정규화된 값
 * @returns {number}
 */
function luminance(hex) {
    const [r, g, b] = [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * @returns {StoreInfo|null} VITE_STORE_NAME이 없으면 null.
 *   틀린 매장명을 띄우는 것보다 아무것도 안 띄우는 편이 안전하다.
 *   단, 로컬 개발 중에는 설정 없이도 구분되도록 기본값을 준다.
 */
export function getStoreInfo() {
    const name = String(import.meta.env['VITE_STORE_NAME'] ?? '').trim();
    if (!name) {
        return import.meta.env.DEV ? { label: '로컬 개발 환경', bg: FALLBACK_BG, fg: LIGHT_TEXT } : null;
    }
    const bg = normalizeHex(String(import.meta.env['VITE_STORE_COLOR'] ?? '')) ?? FALLBACK_BG;
    return { label: name, bg, fg: luminance(bg) < 0.35 ? LIGHT_TEXT : DARK_TEXT };
}
