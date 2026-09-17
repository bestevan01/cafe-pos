// 메뉴 분류. DB의 menu.type에는 영문 키가 들어가고 화면에는 한글 라벨을 보여준다.
//
// 라벨이 메뉴 관리의 <option>에만 하드코딩돼 있어서, 캐셔 화면과 목록 배지에는 'coffee',
// 'tea'가 그대로 노출됐다. 두 화면이 같은 표를 보게 한 곳에 모은다.
//
// 순서가 곧 캐셔 화면의 범주 배치 순서다. 메뉴의 sort_order와 별개로 고정해 둔다 —
// 범주 순서까지 sort_order에서 유도하면, 메뉴 하나를 옮겼을 뿐인데 범주가 통째로
// 따라 움직여 관리자가 이유를 짐작하기 어렵다.

/** @typedef {{type: string, label: string}} MenuCategory */

/** @type {MenuCategory[]} */
export const MENU_CATEGORIES = [
    { type: 'coffee', label: '커피' },
    { type: 'tea', label: '티 · 에이드' },
    { type: 'dessert', label: '디저트' },
];

/**
 * 샷 추가를 받는 분류. 관리자가 메뉴 관리에서 고른 분류가 곧 샷 추가 여부다.
 *
 * 예전에는 이름에 '아메리카노·라떼·아샷추'가 들어가는지로 정했다. 그러면 '딸기 라떼'(티)에도
 * 샷 버튼이 뜨고, '콜드브루'(커피)에는 뜨지 않아 관리자가 예측할 수 없었다.
 * ⚠️ 서버(routes/order.routes.js의 SHOT_TYPES)도 같은 표로 검증한다. 바꿀 때 함께 바꾼다.
 */
export const SHOT_TYPES = ['coffee'];

/**
 * 이 메뉴에 샷을 추가할 수 있는지.
 * @param {{type?: string}} menu
 * @returns {boolean}
 */
export function allowsShot(menu) {
    return SHOT_TYPES.includes(menu.type ?? '');
}

/** 표에 없는 값이 들어왔을 때 쓰는 이름. 메뉴가 화면에서 사라지는 것보다 낫다. */
const UNKNOWN_LABEL = '기타';

/**
 * 분류 키를 화면에 보여줄 이름으로 바꾼다.
 * @param {string|undefined} type
 * @returns {string}
 */
export function categoryLabel(type) {
    return MENU_CATEGORIES.find((c) => c.type === type)?.label ?? type ?? UNKNOWN_LABEL;
}

/**
 * 메뉴를 분류별로 묶는다. 각 묶음 안의 차례는 넘겨받은 순서(= 서버의 sort_order)를 그대로 지킨다.
 *
 * 표에 없는 분류는 버리지 않고 '기타'로 모아 맨 뒤에 붙인다. 관리자가 DB를 직접 고치거나
 * 나중에 분류가 늘었을 때, 캐셔 화면에서 메뉴가 소리 없이 사라지면 주문을 못 받는다.
 *
 * @template {{type?: string}} T
 * @param {T[]} menus
 * @returns {{type: string, label: string, items: T[]}[]}  비어 있는 분류는 빼고 돌려준다
 */
export function groupByCategory(menus) {
    const known = MENU_CATEGORIES.map((c) => ({ ...c, items: /** @type {T[]} */ ([]) }));
    /** @type {T[]} */
    const others = [];

    for (const menu of menus) {
        const bucket = known.find((c) => c.type === menu.type);
        if (bucket) bucket.items.push(menu);
        else others.push(menu);
    }

    const groups = known.filter((c) => c.items.length > 0);
    if (others.length > 0) groups.push({ type: '__other__', label: UNKNOWN_LABEL, items: others });
    return groups;
}
