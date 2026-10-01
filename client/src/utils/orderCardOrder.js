/**
 * 주문 카드 목록(AnimatePresence)은 먼저 들어온 주문부터 그린다. 먼저 들어온 주문을 먼저 처리하므로
 * 화면에서도 위에 온다.
 *
 * 최신을 맨 앞에 그리면 안 되는 이유도 있다: AnimatePresence는 사라지는 카드를 '이전 목록의 자리 번호'대로
 * 새 목록에 끼워 넣는다. 새 주문이 맨 앞에 들어오면서 다른 주문이 빠지면 번호가 밀려 엉뚱한 자리에
 * 들어가고(6,5,4,3,2,1 → 8,7,4,6,2,5,3,1), 그 순서를 맞추느라 React가 남아 있던 카드를 DOM에서 옮긴다.
 * 옮겨진 카드는 등장 애니메이션을 처음부터 다시 하며 크게 튄다. 끊겼다 돌아와 목록을 통째로 다시 받을 때,
 * 또는 주문이 빠지는 애니메이션 도중에 새 주문이 들어올 때 실제로 겪었다.
 * 오래된 것부터 그리면 새 주문은 항상 맨 끝에 붙어 앞쪽 자리 번호가 밀리지 않는다.
 *
 * 카드 key와 정렬은 daily_number가 아니라 display_id(예: 20260930-007)로 한다.
 *  - new_order 신호는 daily_number를 '007'(문자열)로, GET /api/orders는 7(숫자)로 준다. key로 쓰면
 *    실시간으로 받은 카드가 목록을 다시 받을 때마다 다른 카드로 취급돼 사라졌다 다시 나타난다.
 *  - daily_number는 날마다 1부터 다시 센다. 전날 주문이 남아 있으면 번호가 겹친다.
 */

/**
 * @template {{display_id: string}} T
 * @param {T[]} groups
 * @returns {T[]}
 */
export const oldestFirst = (groups) =>
    // numeric: 하루 999건을 넘어 번호가 네 자리가 돼도 날짜·번호를 숫자로 비교한다.
    [...groups].sort((a, b) => a.display_id.localeCompare(b.display_id, undefined, { numeric: true }));
