import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * 목록을 끌어서 순서를 바꾸는 공통 로직. 위생 점검 체크리스트와 메뉴 관리가 같이 쓴다.
 * (두 화면의 조작감이 갈라지지 않게 하려고 한 곳에 모았다)
 *
 * 화면에서 하는 일 세 가지:
 *   1) 잡은 행은 손가락/커서를 따라 '떠서' 움직인다. 슬롯 사이를 툭툭 건너뛰지 않는다.
 *   2) 밀려나는 나머지 행은 FLIP으로 미끄러진다. DOM 순서가 바뀌는 건 CSS 트랜지션으로
 *      애니메이션되지 않으므로, 바뀌기 전 위치를 재 뒀다가 그 차이만큼 거꾸로 밀어 놓고
 *      제자리로 돌려보내는 방식을 쓴다.
 *   3) 목록 위/아래 가장자리에 다다르면 자동으로 스크롤한다. 스크롤 상자 안이면 그 상자를,
 *      아니면 창 전체를 움직인다.
 *
 * 마크업 약속 (호출하는 쪽이 지켜야 한다):
 *   - 목록 컨테이너에 `data-drag-list`
 *   - 각 행에 `data-drag-row`와 `data-drag-id={id}`
 *   - 손잡이에 `onPointerDown={(e) => dragStart(e, idx, id)}`와 CSS `touch-action: none`
 *
 * HTML5 드래그 앤 드롭 API를 쓰지 않는 이유: 모바일 사파리에서 아예 동작하지 않아
 * 관리자가 태블릿·폰으로 열면 순서를 못 바꾼다.
 */

const EDGE = 64; // 가장자리에서 이 거리 안으로 들어오면 자동 스크롤 시작(px)
const MAX_SPEED = 16; // 한 프레임에 움직이는 최대 스크롤 양(px)
const SHIFT_MS = 180; // 밀려난 행이 제자리를 찾아가는 시간

/**
 * 자리를 바꾸는 데 필요한 이동량 (한 칸 높이 대비 비율).
 *
 * ⚠️ 반드시 0.5보다 커야 한다. 0.5로 두면 자리를 옮긴 직후 뜬 행의 중심이 정확히
 * '되돌아가는 경계'에 놓여, 손이 1px만 떨려도 앞뒤로 계속 바뀐다.
 * 0.6이면 옮긴 뒤 0.2칸만큼 여유가 생겨 경계에서 붙었다 떨어졌다 하지 않는다.
 */
const SWAP_RATIO = 0.6;

/** 가장자리에 얼마나 깊이 들어왔는지에 비례해 속도를 정한다(끝으로 갈수록 빨라진다). */
function speedFor(/** @type {number} */ depth) {
    return Math.min(MAX_SPEED, Math.max(2, (depth / EDGE) * MAX_SPEED));
}

/**
 * 목록을 감싸고 있는 스크롤 상자를 찾는다. 없으면 null(창 전체를 스크롤한다).
 * @param {Element|null} el
 * @returns {HTMLElement|null}
 */
function findScroller(el) {
    let node = /** @type {HTMLElement|null} */ (el?.parentElement ?? null);
    while (node && node !== document.body) {
        const overflowY = getComputedStyle(node).overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
        node = node.parentElement;
    }
    return null;
}

/**
 * @param {object} opts
 * @param {(from: number, to: number) => void} opts.onReorder
 *   화면에 보이는 순서를 from → to로 옮겨 달라는 요청. 호출하는 쪽이 자기 배열을 고친다.
 * @param {() => void} opts.onCommit  손을 뗐고 위치가 실제로 바뀌었을 때(저장할 때).
 */
export function useDragSort({ onReorder, onCommit }) {
    const [dragId, setDragId] = useState(/** @type {string|number|null} */ (null));

    // 포인터 이벤트는 렌더보다 훨씬 자주 온다. 드래그 중 상태는 전부 ref로 들고 있고,
    // 화면 표시에 필요한 dragId만 state로 둔다(매 프레임 리렌더를 피하기 위함).
    const dragRef = useRef(
        /** @type {{id: string|number, from: number, moved: boolean, list: Element, row: HTMLElement,
         *          scroller: HTMLElement|null, pointerY: number, grabOffset: number}|null} */ (null),
    );
    const firstTops = useRef(/** @type {Map<string, number>} */ (new Map()));
    // 각 슬롯의 '진짜 자리'(목록 기준 좌표). 목표 위치 판정은 오직 이 표로만 한다.
    const slotsRef = useRef(/** @type {{top: number, height: number}[]} */ ([]));
    const needsFlip = useRef(false);
    const rafRef = useRef(0);

    // 콜백은 렌더마다 새로 만들어지므로 ref로 최신값을 읽는다(드래그 effect가 옛 클로저를 잡지 않도록).
    const cbRef = useRef({ onReorder, onCommit });
    useEffect(() => {
        cbRef.current = { onReorder, onCommit };
    });

    /** 잡은 행이 아닌 나머지 행들. */
    const otherRows = useCallback(() => {
        const d = dragRef.current;
        if (!d) return /** @type {HTMLElement[]} */ ([]);
        return /** @type {HTMLElement[]} */ ([...d.list.querySelectorAll('[data-drag-row]')]).filter(
            (row) => row.dataset.dragId !== String(d.id),
        );
    }, []);

    /**
     * 지금 화면의 '진짜 자리'를 목록 기준 좌표로 기록해 둔다.
     * ⚠️ 모든 행의 변형이 걷힌 상태에서만 불러야 한다(드래그 시작 직후, FLIP의 Last 측정 시점).
     *
     * 왜 표로 떠 두는가: 이동 중에 rect를 그때그때 읽으면 FLIP 애니메이션이 진행 중인
     * 행들의 '움직이는 중간선'을 기준으로 판정하게 된다. 그러면 재배열 → 애니메이션 →
     * 중간선 이동 → 또 재배열이 되먹임을 이뤄 목록이 발발 떤다.
     * 변형은 레이아웃을 바꾸지 않으므로, 변형이 없는 순간에 한 번 재 두면 계속 유효하다.
     */
    const measureSlots = useCallback(() => {
        const d = dragRef.current;
        if (!d) return;
        const listTop = d.list.getBoundingClientRect().top;
        slotsRef.current = /** @type {HTMLElement[]} */ ([...d.list.querySelectorAll('[data-drag-row]')]).map((row) => {
            const b = row.getBoundingClientRect();
            return { top: b.top - listTop, height: b.height };
        });
    }, []);

    /**
     * 잡은 행을 포인터 위치에 맞춰 띄운다.
     *
     * 목록의 첫 칸 위나 마지막 칸 아래로는 나가지 못하게 가둔다. 안 그러면 커서를 목록
     * 밖으로 끌었을 때 행이 헤더 뒤나 화면 밖으로 사라져, 뭘 잡고 있는지 안 보인다.
     * 어차피 그보다 위/아래에는 놓을 자리가 없으므로 가둬도 잃는 것이 없다.
     */
    const floatRow = useCallback(() => {
        const d = dragRef.current;
        if (!d) return;
        // 지금 걸려 있는 변형을 걷어내고 '진짜 자리'를 잰다. 안 그러면 이전 변형 위에
        // 또 변형을 얹어 행이 화면 밖으로 날아간다.
        d.row.style.transform = '';
        const rect = d.row.getBoundingClientRect();

        // 포인터를 따라갈 때 행의 윗변이 놓일 자리(뷰포트 기준)
        let top = d.pointerY - d.grabOffset;

        const slots = slotsRef.current;
        if (slots.length > 0) {
            const listTop = d.list.getBoundingClientRect().top;
            const last = slots[slots.length - 1];

            // 보이는 영역. 목록 경계만 막으면, 스크롤 상자 안에 있는 표에서 목록 위쪽 끝이
            // 이미 스크롤돼 올라간 상태일 때 행이 여전히 안 보이는 곳으로 간다.
            const view = d.scroller ? d.scroller.getBoundingClientRect() : null;
            const viewTop = view ? view.top : 0;
            const viewBottom = view ? view.bottom : window.innerHeight;

            // 목록 안이면서 동시에 눈에 보이는 범위로 가둔다.
            const min = Math.max(listTop + slots[0].top, viewTop);
            const max = Math.min(listTop + last.top + last.height, viewBottom) - rect.height;
            // max가 min보다 작아지는 경우(보이는 높이가 행 하나보다 낮을 때)는 min을 우선한다.
            top = Math.min(Math.max(top, min), Math.max(min, max));
        }

        d.row.style.transform = `translateY(${top - rect.top}px)`;
    }, []);

    /** 포인터가 넘어선 슬롯을 찾아 순서 변경을 요청한다. */
    const applyTarget = useCallback(() => {
        const d = dragRef.current;
        const slots = slotsRef.current;
        if (!d || slots.length === 0) return;
        // 직전 재배열이 아직 화면에 반영되지 않았다면 슬롯 표가 옛것이다. 그 상태로 판정하면
        // d.from(이미 갱신됨)과 슬롯 좌표(아직 옛것)가 어긋나 한 번에 두 칸씩 건너뛴다.
        // 포인터는 초당 100번 넘게 들어오지만 화면 반영은 그보다 느려서 실제로 일어난다.
        // 반영되면 아래 useLayoutEffect가 이 표시를 지우고 슬롯 표를 다시 재므로, 그냥 건너뛴다.
        if (needsFlip.current) return;

        // 판정 기준은 '포인터'가 아니라 '뜬 행의 중심'이다. 포인터로 재면, 손잡이를 행 중앙에서
        // 잡았을 때 포인터가 이미 그 슬롯의 중간선 위에 있어서 0px만 움직여도 다음 칸으로 넘어간다.
        // 목록 기준 좌표로 바꾼다 — 스크롤되면 목록 자체가 움직이므로 매번 다시 읽는다
        // (목록 컨테이너에는 변형을 걸지 않으므로 이 값은 항상 진짜 위치다).
        const listTop = d.list.getBoundingClientRect().top;
        const cur = Math.min(Math.max(d.from, 0), slots.length - 1);
        const h = slots[cur].height;
        // 잡은 지점(grabOffset)을 빼면 뜬 행의 윗변, 거기에 절반을 더하면 중심이다.
        // 가만히 있으면 이 값이 제 슬롯의 중간선과 정확히 같아 아래 두 루프가 모두 안 돈다.
        const center = d.pointerY - d.grabOffset - listTop + h / 2;

        // 이웃 슬롯 안쪽에 그은 선을 넘어야 자리를 옮긴다. SWAP_RATIO가 0.5면 경계선과
        // 같아지므로, 넘은 만큼(SWAP_RATIO - 0.5)을 이웃 슬롯 안쪽으로 밀어 넣어 그린다.
        // while로 도는 이유: 빠르게 끌면 한 번에 여러 칸을 건너뛴다.
        let to = cur;
        while (to + 1 < slots.length) {
            const next = slots[to + 1];
            if (center <= next.top + next.height * (SWAP_RATIO - 0.5)) break;
            to++;
        }
        while (to - 1 >= 0) {
            const prev = slots[to - 1];
            if (center >= prev.top + prev.height * (1.5 - SWAP_RATIO)) break;
            to--;
        }
        if (to === d.from) return;

        // FLIP의 'First' — 순서가 바뀌기 전, 지금 눈에 보이는 위치를 기록해 둔다.
        firstTops.current.clear();
        for (const row of otherRows()) {
            firstTops.current.set(row.dataset.dragId ?? '', row.getBoundingClientRect().top);
        }
        needsFlip.current = true;

        const from = d.from;
        d.from = to;
        d.moved = true;
        cbRef.current.onReorder(from, to);
    }, [otherRows]);

    // 순서가 바뀐 직후(DOM 반영 후) 밀려난 행들을 원래 보이던 자리에서 새 자리로 미끄러뜨린다.
    useLayoutEffect(() => {
        if (!needsFlip.current) return;
        needsFlip.current = false;
        const d = dragRef.current;
        if (!d) return;
        const rows = otherRows();

        // 'Last' — 남아 있는 변형을 걷어내고 진짜 자리를 잰다. 앞선 애니메이션이 끝나기 전에
        // 다시 움직이면, 변형이 걸린 위치를 새 자리로 착각해 오차가 쌓인다.
        for (const row of rows) {
            row.style.transition = 'none';
            row.style.transform = '';
        }
        d.row.style.transform = ''; // 뜬 행도 잠시 내려놓는다(맨 아래에서 다시 띄운다)

        // 모든 행이 변형 없이 '진짜 자리'에 있는 유일한 순간이다. 슬롯 표를 여기서 갱신한다.
        measureSlots();
        /** @type {[HTMLElement, number][]} */
        const inverts = [];
        for (const row of rows) {
            const first = firstTops.current.get(row.dataset.dragId ?? '');
            if (first === undefined) continue;
            const delta = first - row.getBoundingClientRect().top;
            if (delta) inverts.push([row, delta]);
        }
        // 'Invert' — 보이던 자리로 되돌려 놓고,
        for (const [row, delta] of inverts) row.style.transform = `translateY(${delta}px)`;
        // 되돌린 상태를 브라우저에 확정시킨다. 이 한 줄이 없으면 아래에서 변형을 푸는 것과
        // 한 묶음으로 계산돼 애니메이션 없이 곧바로 새 자리에 그려진다.
        // requestAnimationFrame 대신 강제 리플로우를 쓰는 이유: 탭이 백그라운드로 내려가
        // rAF가 멈추면 행이 되돌려진 자리에 그대로 굳어버린다. 리플로우는 항상 즉시 처리된다.
        void (/** @type {HTMLElement} */ (d.list).offsetHeight);
        // 'Play' — 변형을 풀어 제자리로 미끄러지게 한다.
        for (const [row] of inverts) {
            row.style.transition = `transform ${SHIFT_MS}ms ease`;
            row.style.transform = '';
        }
        floatRow(); // 다른 행이 움직였으니 뜬 행의 기준 위치도 다시 맞춘다
    });

    // 손잡이를 눌렀을 때. JSDoc은 useCallback을 감싼 변수가 아니라 안쪽 화살표 함수에 붙여야
    // 매개변수 타입이 잡힌다(변수에 붙이면 implicit any가 된다).
    const dragStart = useCallback(
        /**
         * @param {import('react').PointerEvent<HTMLElement>} e
         * @param {number} idx  목록에서의 현재 위치
         * @param {string|number} id
         */
        (e, idx, id) => {
            e.preventDefault();
            const list = /** @type {HTMLElement|null} */ (e.currentTarget.closest('[data-drag-list]'));
            const row = /** @type {HTMLElement|null} */ (e.currentTarget.closest('[data-drag-row]'));
            if (!list || !row) return;

            dragRef.current = {
                id,
                from: idx,
                moved: false,
                list,
                row,
                scroller: findScroller(list),
                pointerY: e.clientY,
                // 행의 어디를 잡았는지. 이걸 빼 줘야 잡은 지점이 커서에 붙어 있는 것처럼 보인다.
                grabOffset: e.clientY - row.getBoundingClientRect().top,
            };
            measureSlots(); // 아직 아무 변형도 없는 상태 — 초기 슬롯 표
            setDragId(id);
        },
        [measureSlots],
    );

    // 이동·종료는 손잡이가 아니라 window에서 듣는다. 손잡이가 작아서 끄는 도중 포인터가
    // 금방 벗어나는데 그때 이벤트가 끊기면 안 된다. setPointerCapture는 실패하면
    // 드래그가 아무 표시 없이 죽어버려서 쓰지 않는다.
    useEffect(() => {
        if (dragId === null) return undefined;

        /** @param {PointerEvent} e */
        const onMove = (e) => {
            const d = dragRef.current;
            if (!d) return;
            d.pointerY = e.clientY;
            applyTarget();
            floatRow();
        };

        // 자동 스크롤은 포인터가 멈춰 있어도 계속돼야 한다. 그래서 pointermove가 아니라
        // 매 프레임 도는 루프에서 처리한다(가장자리에 대고 가만히 있으면 계속 스크롤된다).
        const tick = () => {
            const d = dragRef.current;
            if (!d) return;
            const y = d.pointerY;
            let moved = 0;

            if (d.scroller) {
                const b = d.scroller.getBoundingClientRect();
                if (y < b.top + EDGE) moved = -speedFor(b.top + EDGE - y);
                else if (y > b.bottom - EDGE) moved = speedFor(y - (b.bottom - EDGE));
                if (moved) {
                    const before = d.scroller.scrollTop;
                    d.scroller.scrollTop += moved;
                    moved = d.scroller.scrollTop - before; // 끝에 닿으면 0
                }
            } else {
                const h = window.innerHeight;
                if (y < EDGE) moved = -speedFor(EDGE - y);
                else if (y > h - EDGE) moved = speedFor(y - (h - EDGE));
                if (moved) {
                    const before = window.scrollY;
                    window.scrollBy(0, moved);
                    moved = window.scrollY - before;
                }
            }

            // 스크롤로 행들이 포인터 밑을 지나갔으니 목표 자리를 다시 계산한다.
            if (moved) {
                applyTarget();
                floatRow();
            }
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);

        const onEnd = () => {
            const d = dragRef.current;
            cancelAnimationFrame(rafRef.current);

            if (d) {
                // 걸어 둔 변형을 모두 걷어낸다. 남겨 두면 다음 렌더에서 행이 어긋난 자리에 그려진다.
                d.row.style.transform = '';
                d.row.style.transition = '';
                for (const row of otherRows()) {
                    row.style.transform = '';
                    row.style.transition = '';
                }
            }
            dragRef.current = null;
            setDragId(null);
            // 위치가 실제로 바뀐 경우에만 저장한다(그냥 눌렀다 뗀 것까지 저장 요청을 보내지 않는다).
            if (d?.moved) cbRef.current.onCommit();
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onEnd);
        window.addEventListener('pointercancel', onEnd);
        return () => {
            cancelAnimationFrame(rafRef.current);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onEnd);
            window.removeEventListener('pointercancel', onEnd);
        };
    }, [dragId, applyTarget, floatRow, otherRows]);

    return { dragId, dragStart };
}
