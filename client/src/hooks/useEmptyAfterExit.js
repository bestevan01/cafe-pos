import { useState, useCallback } from 'react';

/**
 * 목록이 비었다는 안내를 마지막 항목이 다 사라진 뒤에 띄운다.
 *
 * AnimatePresence 안의 마지막 항목이 빠지면 개수는 바로 0이 되지만, 그 항목은 exit 애니메이션 동안
 * 자리를 계속 차지한다. 그때 '비었습니다' 문구를 바로 그리면 사라지는 카드 옆(아래)에 나왔다가
 * 카드가 빠지는 순간 위로 튄다. 그래서 0이 된 순간에는 숨기고, onExitComplete에서 보여준다.
 *
 * 처음부터 비어 있으면 빠질 항목이 없으므로 바로 보여준다.
 *
 * @param {number} count 현재 항목 수
 * @returns {{showEmpty: boolean, onExitComplete: () => void}}
 *   showEmpty — 안내 문구를 그려도 되는지(count가 0일 때만 true)
 *   onExitComplete — AnimatePresence에 그대로 넘긴다
 */
export function useEmptyAfterExit(count) {
    const [prevCount, setPrevCount] = useState(count);
    const [settled, setSettled] = useState(true);

    // 이전 렌더와 개수를 비교해 상태를 맞춘다(렌더 중 조건부 setState — React가 권장하는 파생 상태 방식).
    // effect로 하면 0이 된 첫 프레임에 문구가 한 번 그려져 버린다.
    if (prevCount !== count) {
        setPrevCount(count);
        if (count === 0 && prevCount > 0) setSettled(false);
    }

    const onExitComplete = useCallback(() => setSettled(true), []);

    return { showEmpty: count === 0 && settled, onExitComplete };
}
