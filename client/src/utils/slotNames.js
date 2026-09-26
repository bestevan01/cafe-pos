/**
 * 회차 이름을 화면용으로 만든다. 이름이 겹치면 시각을 붙인다.
 *
 * 회차 이름은 매장이 정한다(예: 월~수 17:00 '마감', 목 16:00 '마감'). 보통은 그날 회차만 보여서
 * 겹치지 않지만, 미운영일에는 전체 회차가 한꺼번에 보여 '마감'이 두 번 나온다.
 * 기록에 남는 이름(slot_label)은 그대로 두고 화면에서만 구분한다.
 *
 * @param {{slot_key: string, label: string, run_at?: string|null}[]} list
 * @returns {(slotKey: string) => string}
 */
export function slotNames(list) {
    /** @type {Map<string, number>} */
    const count = new Map();
    for (const s of list) count.set(s.label, (count.get(s.label) ?? 0) + 1);
    /** @type {Map<string, string>} */
    const byKey = new Map(
        list.map((s) => [s.slot_key, (count.get(s.label) ?? 0) > 1 && s.run_at ? `${s.label}(${s.run_at})` : s.label]),
    );
    return (slotKey) => byKey.get(slotKey) ?? slotKey;
}
