// 위생점검 기본 체크리스트.
// 관리자가 '기본 항목 불러오기'를 눌렀을 때만 들어간다(자동 시딩 아님).
// 매장 사정에 맞게 편집하는 것을 전제로 한 출발점이며, 법정 서식이 아니다.
//
// 배열 순서가 그대로 sort_order가 되므로, 실제 점검 동선(개인 → 기구 → 보관 → 홀 → 폐기물)을 따른다.

// 분류는 고정 목록이다. 자유 입력이면 '냉장·냉동'과 '냉장/냉동'처럼 같은 뜻이 갈려
// 보고서에서 묶이지 않는다. 목록을 늘릴 때는 여기만 고치고 클라이언트 CATEGORIES와 맞춘다.
const HYGIENE_CATEGORIES = ['개인위생', '조리·기구', '냉장·냉동', '매장·홀', '폐기물', '기타'];

/** @type {{label: string, category: string}[]} */
const DEFAULT_HYGIENE_ITEMS = [
    { label: '건강 이상(발열·설사·감기) 없이 근무 가능한 상태인가', category: '개인위생' },
    { label: '손 씻기 후 근무를 시작했는가', category: '개인위생' },
    { label: '앞치마·복장이 청결한가', category: '개인위생' },
    { label: '손톱이 짧고 반지·시계를 착용하지 않았는가', category: '개인위생' },

    { label: '제빙기 내부와 얼음 스쿱이 청결한가', category: '조리·기구' },
    { label: '블렌더·쉐이커를 사용 후 세척해 두었는가', category: '조리·기구' },
    { label: '커피머신 추출구와 스팀 완드를 청소했는가', category: '조리·기구' },
    { label: '행주·수세미를 소독하고 젖은 채로 방치하지 않았는가', category: '조리·기구' },

    { label: '냉장고 온도가 5℃ 이하인가', category: '냉장·냉동' },
    { label: '냉동고 온도가 -18℃ 이하인가', category: '냉장·냉동' },
    { label: '개봉한 우유·시럽에 개봉일을 표기했는가', category: '냉장·냉동' },
    { label: '유통기한이 지난 재료가 없는가', category: '냉장·냉동' },

    { label: '작업대와 싱크대를 소독했는가', category: '매장·홀' },
    { label: '음료 제공 구역에 개인 물품이 놓여 있지 않은가', category: '매장·홀' },
    { label: '바닥에 물기나 미끄러운 곳이 없는가', category: '매장·홀' },

    { label: '쓰레기통을 비우고 뚜껑을 닫아 두었는가', category: '폐기물' },
    { label: '음식물 쓰레기를 당일 처리했는가', category: '폐기물' },
];

module.exports = { DEFAULT_HYGIENE_ITEMS, HYGIENE_CATEGORIES };
