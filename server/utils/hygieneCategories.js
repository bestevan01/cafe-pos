// 위생점검 항목의 분류 목록.
//
// 고정 목록으로 두는 이유: 자유 입력이면 '냉장·냉동'과 '냉장/냉동'처럼 같은 뜻이 갈려
// 보고서에서 한 묶음으로 모이지 않는다.
// 목록을 늘릴 때는 여기와 클라이언트(HygieneItems.jsx의 CATEGORIES)를 함께 고친다.

const HYGIENE_CATEGORIES = ['개인위생', '조리·기구', '냉장·냉동', '매장·홀', '폐기물', '기타'];

module.exports = { HYGIENE_CATEGORIES };
