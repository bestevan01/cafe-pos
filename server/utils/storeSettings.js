const pool = require('../config/db');

/**
 * 매장별 설정(키-값). 매장마다 서버·DB가 따로라 이 표도 매장 것이다.
 *
 * 코드는 매장끼리 공유하므로, 매장마다 다른 문구·값은 코드가 아니라 여기에 둔다.
 * 기능마다 표를 하나씩 만들 만큼의 값이 아닐 때 쓴다(예: 위생 점검 안내 문구).
 */

/** 키 목록. 아무 키나 받지 않도록 여기서 정한다. */
const KEYS = {
    hygieneGuide: { key: 'hygiene_guide', max: 1000 },
};

/**
 * @param {keyof typeof KEYS} name
 * @returns {Promise<{value: string, updated_at: any, updated_by_name: string|null}|null>}
 */
async function getSetting(name) {
    const [[row]] = await pool.query(
        'SELECT setting_value AS value, updated_at, updated_by_name FROM store_settings WHERE setting_key = ?',
        [KEYS[name].key],
    );
    return row ?? null;
}

/**
 * 빈 문자열이면 지운다.
 * @param {keyof typeof KEYS} name
 * @param {string} value
 * @param {string} byName
 */
async function setSetting(name, value, byName) {
    const { key, max } = KEYS[name];
    const v = String(value ?? '')
        .trim()
        .slice(0, max);
    if (!v) {
        await pool.query('DELETE FROM store_settings WHERE setting_key = ?', [key]);
        return;
    }
    await pool.query(
        `INSERT INTO store_settings (setting_key, setting_value, updated_by_name)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by_name = VALUES(updated_by_name)`,
        [key, v, byName],
    );
}

module.exports = { getSetting, setSetting };
