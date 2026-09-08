/**
 * 여러 번 불려도 마지막 호출로부터 wait 밀리초가 지난 뒤 한 번만 실행한다.
 *
 * 주문 하나가 생성 → 결제 → 완료 → 전달로 소켓 이벤트를 네 번 쏜다. 그때마다 통계를
 * 다시 받아오면 바쁜 시간대에 요청이 몰리는데, 결과는 마지막 한 번과 같다.
 * 화면에 보이는 값이 0.4초 늦어지는 대신 요청이 크게 줄어든다.
 *
 * 함수에 cancel 속성을 붙이는 대신 객체로 돌려준다 — JSDoc 타입 검사에서
 * 함수에 임의 속성을 다는 것이 걸린다.
 *
 * @param {() => void} fn
 * @param {number} [wait]
 * @returns {{run: () => void, cancel: () => void}}
 */
export function debounce(fn, wait = 400) {
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let timer;
    return {
        run: () => {
            clearTimeout(timer);
            timer = setTimeout(fn, wait);
        },
        cancel: () => clearTimeout(timer),
    };
}
