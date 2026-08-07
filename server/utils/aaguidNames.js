// 잘 알려진 AAGUID → 패스키 '제공자'(실제로 자격증명이 저장·동기화되는 곳) 이름.
// 패스키는 기기가 아니라 제공자(iCloud 키체인 등)에 저장되어 여러 기기에 동기화되므로,
// '등록 기기'보다 제공자로 이름 짓는 게 더 정확하다.
// 출처: FIDO MDS / passkey-authenticator-aaguids 커뮤니티 목록 중 주요 소비자 제공자.
const AAGUID_NAMES = {
    'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'iCloud 키체인', // Apple (iOS/macOS)
    'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google 비밀번호 관리자', // Android/Google
    'adce0002-35bc-c60a-648b-0b25f1f05503': 'Chrome (Mac)',
    '08987058-cadc-4b81-b6e1-30de50dcbe96': 'Windows Hello',
    '9ddd1817-af5a-4672-a2b9-3e3dd95000a9': 'Windows Hello',
    '6028b017-b1d4-4c02-b4b3-afcdafc96bb2': 'Windows Hello',
    'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
    'd548826e-79b4-db40-a3d8-11116f7e8349': 'Bitwarden',
    '531126d6-e717-415c-9320-3d9aa6981239': 'Dashlane',
    'ee882879-721c-4913-9775-3dfcce97072a': 'YubiKey 5',
    'fa2b99dc-9e39-4257-8f92-4a30d23c4118': 'YubiKey 5 NFC',
};

/**
 * AAGUID 문자열을 알려진 제공자 이름으로 변환. 미상/미제공(0000…)이면 null.
 * @param {string} aaguid
 * @returns {string|null}
 */
/** @param {string|null|undefined} aaguid */
function aaguidToProviderName(aaguid) {
    if (!aaguid) return null;
    const id = String(aaguid).toLowerCase();
    if (id === '00000000-0000-0000-0000-000000000000') return null; // 프라이버시상 미제공
    return /** @type {Record<string, string>} */ (AAGUID_NAMES)[id] || null;
}

module.exports = { aaguidToProviderName };
