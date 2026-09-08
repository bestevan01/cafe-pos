import axios from 'axios';

const authCfg = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

/**
 * 사진 한 장을 R2에 올린다.
 *
 * 파일 본문은 서버를 거치지 않는다. 서버에서 서명된 URL만 받아 브라우저가 R2로 직접 PUT한다.
 * 그래서 2단계는 axios가 아니라 fetch를 쓴다 — axios에는 baseURL과 인증 인터셉터가 걸려 있어
 * R2로 우리 토큰이 새어 나가고, 서명과 무관한 헤더가 붙어 요청이 거부된다.
 *
 * 지금은 압축도 크기 제한도 걸지 않는다(원본 그대로). 한 달간 실제 데이터를 쌓아 판단하기로 했다.
 *
 * @param {File} file
 * @param {number} itemId 어느 점검 항목의 사진인지
 * @returns {Promise<number>} photo_id
 */
export async function uploadHygienePhoto(file, itemId) {
    // 1) 자리 확보 + 서명 URL
    const sign = await axios.post('/api/hygiene/uploads/sign', { content_type: file.type, item_id: itemId }, authCfg());
    const { photo_id: photoId, upload_url: uploadUrl } = sign.data;

    // 2) R2로 직접 업로드
    const put = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
    });
    if (!put.ok) {
        // CORS에 막히면 여기까지 오지 못하고 fetch가 예외로 끝난다.
        throw new Error(`업로드 실패 (${put.status})`);
    }

    // 3) 서버에 알림. 서버가 R2에 실제 크기·타입을 다시 확인한다.
    const size = await readSize(file);
    await axios.post(`/api/hygiene/uploads/${photoId}/confirm`, size, authCfg());
    return photoId;
}

/** @param {number} photoId */
export async function deleteHygienePhoto(photoId) {
    await axios.delete(`/api/hygiene/uploads/${photoId}`, authCfg());
}

/**
 * 조회용 서명 URL. 만료가 짧아 캐시하지 않고 볼 때마다 받는다.
 * @param {number} photoId
 * @returns {Promise<string|null>} 보관 기간이 지났으면 null
 */
export async function getHygienePhotoUrl(photoId) {
    try {
        const res = await axios.get(`/api/hygiene/photos/${photoId}/url`, authCfg());
        return res.data.url;
    } catch (/** @type {any} */ err) {
        if (err?.response?.status === 410) return null; // 보관 기간(2년) 만료
        throw err;
    }
}

/**
 * 원본 해상도를 읽는다. 나중에 "어떤 크기의 사진이 올라오는지" 판단할 근거로 쓴다.
 * HEIC처럼 브라우저가 디코딩하지 못하는 형식이면 실패하는데, 그때는 크기 없이 진행한다 —
 * 부가 정보 때문에 업로드 자체가 막히면 안 된다.
 * @param {File} file
 */
async function readSize(file) {
    try {
        const bmp = await createImageBitmap(file);
        const size = { width: bmp.width, height: bmp.height };
        bmp.close();
        return size;
    } catch {
        return {};
    }
}
