const pool = require('../config/db');

/**
 * 가장 최근 조사 기준의 재고 현황.
 *
 * 관리자 화면과 알림이 같은 함수를 쓴다. 각자 계산하면 화면에는 '주문 필요'가 떴는데
 * 알림은 안 오는(또는 그 반대) 일이 생긴다. 판단 기준은 한 곳에만 있어야 한다.
 */

// slot은 'HHMM'이라 문자열 정렬이 곧 시간 순이다. 회차가 몇 개든 ORDER BY slot 하나로 끝난다.

/**
 * 조사 한 줄을 판단한다. 현재 재고와 조사 기록이 같은 함수를 쓴다 — 따로 계산하면 기록 목록의
 * '주문 N건'과 현재 재고의 '주문 필요'가 서로 다른 기준으로 갈린다(실제로 그랬다: 기록 쪽은
 * 저울 품목에서 빈 통 무게를 빼지 않고 미개봉 통도 세지 않았다).
 *
 * ── 저울 초과(over_scale) ──
 * 저울 최대 무게(예: 1000g)보다 무거운 통은 잴 수 없다. 거의 가득 찬 통이 그렇다.
 * 그때는 quantity에 저울 최대 무게를 넣고 '이 이상'으로 표시한다(at_least). 값을 지어내지 않는다.
 * 주문 판단: 잴 수 있는 최솟값이 기준보다 많으면 확실히 충분하다. 기준이 그보다 높게 잡혀 있으면
 * 판단할 수 없어 low_unknown으로 알린다(관리자 화면이 기준을 낮추라고 안내한다).
 *
 * @param {any} it 조사 항목 행(tare_g는 품목의 현재 값으로 메운 것)
 * @param {{quantity: number, over: boolean}|null} prev 직전 회차의 같은 품목
 */
function evaluate(it, prev) {
    const quantity = Number(it.quantity);
    const threshold = it.low_threshold === null ? null : Number(it.low_threshold);
    const isWeight = it.measure_mode === 'weight';
    const atLeast = isWeight && Number(it.over_scale) === 1;
    // 저울은 통을 올린 채 재므로 통 무게를 빼야 실제 내용물이 나온다.
    const net = isWeight && it.tare_g !== null ? Number((quantity - Number(it.tare_g)).toFixed(2)) : null;
    // 비워둘 수 있다 — 빨대처럼 한 봉에 든 개수가 들쭉날쭉하면 환산 자체가 거짓말이 된다.
    const perPack = it.count_per_pack === null ? null : Number(it.count_per_pack);
    const spare = Number(it.spare_count ?? 0);
    // 실제로 남은 양 = 쓰고 있는 통 + 창고의 미개봉분.
    // 주문 판단은 반드시 이 값으로 한다. 개봉한 통만 보면 창고에 여분이 쌓여 있어도
    // '주문 필요'가 떠서 헛주문을 하게 된다. 저울 초과면 이 값은 '최솟값'이다.
    const total = isWeight
        ? net === null || perPack === null
            ? net
            : Number((net + spare * perPack).toFixed(2))
        : quantity;
    // 기준치가 없으면 판단하지 않는다. 0을 기준으로 삼으면 모든 품목이 '충분'으로 보인다.
    // 통 무게를 아직 못 재 순중량을 모르면 총중량으로라도 따진다(과소평가라 놓치지는 않는다).
    const underThreshold = threshold !== null && (total ?? quantity) <= threshold;
    // 증감은 둘 다 실제로 잰 값일 때만 낸다. 한쪽이 '이 이상'이면 차이가 거짓 숫자가 된다.
    const delta = prev === null || atLeast || prev.over ? null : Number((quantity - prev.quantity).toFixed(2));
    return {
        ...it,
        quantity,
        spare_count: spare,
        over_scale: atLeast ? 1 : 0,
        at_least: atLeast,
        total,
        low_threshold: threshold,
        is_low: !atLeast && underThreshold,
        // 잴 수 있는 최솟값이 기준 이하라 충분한지 알 수 없다(기준이 저울 한계보다 높다).
        low_unknown: atLeast && underThreshold,
        prev_quantity: prev === null ? null : prev.quantity,
        delta,
        net,
        // 통 무게를 아직 못 쟀다는 뜻. 화면에서 '총중량만'이라고 알려준다.
        tare_missing: isWeight && it.tare_g === null,
        // 몇 통어치인지. 눈대중으로 '0.5통'이라 부르던 감각을 숫자로 돌려준다.
        full_ratio: net !== null && perPack ? Number((net / perPack).toFixed(2)) : null,
        total_ratio: total !== null && perPack ? Number((total / perPack).toFixed(2)) : null,
        // 환산값: 2.3봉 × 500g = 1150g. 환산값이 없으면 내보내지 않는다(거짓 숫자를 만들지 않는다).
        amount: isWeight ? total : perPack ? Number((quantity * perPack).toFixed(2)) : null,
        // 봉 단위 품목은 정수부가 '안 뜯은 개수', 소수부가 '뜯어 쓰는 것의 남은 비율'이다.
        // 0.8봉과 1.2봉은 숫자가 비슷해도 사정이 전혀 다르다 — 앞은 여분이 없고 뒤는 한 봉이
        // 통째로 남아 있다. 한 덩어리로 보여주면 그 차이가 묻히므로 쪼개어 내보낸다.
        unopened: isWeight ? spare : Math.floor(quantity),
        opened_ratio: isWeight ? null : Number((quantity - Math.floor(quantity)).toFixed(2)),
    };
}

/**
 * 제출(확정)한 조사만 본다. 임시 저장은 칸이 비어 있고 아직 기록이 아니다 — 여기서 걸러야
 * 현재 재고 화면과 '주문 필요' 알림(제출 직후·정해진 시각 모두 이 함수를 쓴다)이 함께 걸러진다.
 * @returns {Promise<{count: any|null, rows: any[], low: any[]}>}
 */
async function latestStatus() {
    const [[latest]] = await pool.query(
        `SELECT c.id, DATE_FORMAT(c.count_date, '%Y-%m-%d') AS count_date, c.slot, c.slot_label,
                c.counted_at, c.counted_by_name, c.memo
         FROM inventory_counts c
         WHERE c.is_draft = 0
         ORDER BY c.count_date DESC, c.slot DESC
         LIMIT 1`,
    );
    if (!latest) return { count: null, rows: [], low: [] };

    const [[prev]] = await pool.query(
        `SELECT c.id
         FROM inventory_counts c
         WHERE c.is_draft = 0 AND ((c.count_date < ?) OR (c.count_date = ? AND c.slot < ?))
         ORDER BY c.count_date DESC, c.slot DESC
         LIMIT 1`,
        [latest.count_date, latest.count_date, latest.slot],
    );

    // 통 무게(tare_g)는 기록에 복사해 두지만, 통을 다 비워야 잴 수 있어 비어 있는 경우가 많다.
    // 비어 있으면 품목의 현재 값으로 메운다 — 통 무게는 정책이 아니라 물건의 물리적 성질이라,
    // 나중에 알게 됐을 뿐 그 전에도 같은 값이었다. 덕분에 처음 입력하는 순간 지난 기록의
    // 순중량까지 함께 드러난다. (low_threshold는 반대다. 정책이라 복사본을 그대로 쓴다)
    const [items] = await pool.query(
        `SELECT i.item_id, i.item_label, i.measure_mode, i.count_unit, i.count_per_pack,
                i.base_unit, COALESCE(i.container_unit, g.container_unit, '통') AS container_unit,
                COALESCE(i.tare_g, g.tare_g) AS tare_g, i.low_threshold,
                i.quantity, i.spare_count, i.over_scale, i.sort_order
         FROM inventory_count_items i
                  LEFT JOIN inventory_items g ON g.id = i.item_id
         WHERE i.count_id = ?
         ORDER BY i.sort_order, i.id`,
        [latest.id],
    );

    /** @type {Map<number, {quantity: number, over: boolean}>} */
    const before = new Map();
    if (prev) {
        const [prevItems] = await pool.query(
            'SELECT item_id, quantity, over_scale FROM inventory_count_items WHERE count_id = ?',
            [prev.id],
        );
        for (const p of prevItems) {
            if (p.item_id != null) before.set(p.item_id, { quantity: Number(p.quantity), over: p.over_scale === 1 });
        }
    }

    const rows = items.map((/** @type {any} */ it) => {
        const p = it.item_id != null ? before.get(it.item_id) : undefined;
        return evaluate(it, p ?? null);
    });

    return { count: latest, rows, low: rows.filter((/** @type {any} */ r) => r.is_low) };
}

/** 알림 문구. '무엇을 얼마나' 없이 '주문 필요'만 뜨면 화면을 열어봐야 알 수 있다. */
function lowAlertText(/** @type {any} */ status) {
    const names = status.low.map((/** @type {any} */ r) => r.item_label);
    const head = names.slice(0, 5).join(', ');
    const more = names.length > 5 ? ` 외 ${names.length - 5}건` : '';
    return {
        title: `재고 주문 필요 ${names.length}건`,
        body: `${head}${more}\n(${status.count.count_date} ${status.count.slot_label ?? status.count.slot} 조사 기준)`,
    };
}

module.exports = { latestStatus, lowAlertText, evaluate };
