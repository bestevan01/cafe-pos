const { createSlotSchedule, slotSql, toMinutes, toHHMM } = require('./slotSchedule');

/**
 * 재고 조사 회차. 공통 동작은 utils/slotSchedule.js에 있다(위생 점검과 함께 쓴다).
 *
 * 코드는 매장끼리 공유하므로 기본 회차를 깔지 않는다. 비어 있는 동안에는 하루 한 번('조사')으로
 * 기록된다 — 설정 전에도 조사를 못 하게 막지는 않는다.
 */
const inventorySlots = createSlotSchedule({
    table: 'inventory_slots',
    alertKey: 'inventory_count_reminder',
    what: '재고 조사',
    fallback: [{ slot_key: '0000', label: '조사', run_at: '00:00' }],
});

module.exports = {
    inventorySlots,
    loadSlots: inventorySlots.loadSlots,
    currentSlot: inventorySlots.currentSlot,
    syncInventoryReminders: inventorySlots.syncReminders,
    slotSql,
    toMinutes,
    toHHMM,
};
