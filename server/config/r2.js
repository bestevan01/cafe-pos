const {
    S3Client,
    HeadObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    PutObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Cloudflare R2. S3 호환 API로 붙는다.
//
// 파일은 브라우저 ↔ R2 사이에서만 오간다. 서버는 서명한 URL만 내주고 파일 본문은 만지지 않는다.
// Render 무료 인스턴스(CPU 0.1, 대역폭 월 5GB)에서 사진 바이트를 통째로 빼내기 위한 구조다.
//
// 필요한 환경변수 (매장마다 다른 버킷을 가리킨다):
//   R2_ENDPOINT           https://<account>.r2.cloudflarestorage.com  (대시보드에서 복사)
//   R2_ACCESS_KEY_ID
//   R2_SECRET_ACCESS_KEY
//   R2_BUCKET

const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;

// 조건에 상수를 그대로 써야 아래 분기 안에서 undefined가 아님이 보장된다.
const client =
    R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET
        ? new S3Client({
              region: 'auto', // R2는 리전 개념이 없다. SDK가 요구해서 넣는 값.
              endpoint: R2_ENDPOINT,
              credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
          })
        : null;

/** 넷 중 하나라도 없으면 사진 기능만 꺼진다. 점검 자체는 사진 없이도 굴러가야 한다. */
const isConfigured = client !== null;

if (!isConfigured) {
    console.warn(
        '⚠️ [R2] 환경변수가 없어 사진 첨부 기능이 꺼집니다. (R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET)',
    );
}

/**
 * 설정이 없는데 호출되면 여기서 분명하게 실패시킨다.
 * 라우터에서 isConfigured로 먼저 막지만, 그 가드를 빠뜨린 경로가 생겨도
 * 알아보기 힘든 TypeError 대신 원인이 드러나는 오류가 남는다.
 */
function requireR2() {
    if (!client || !R2_BUCKET) throw new Error('R2 환경변수가 설정되지 않았습니다.');
    return { client, bucket: R2_BUCKET };
}

/** 업로드용 서명 URL. 이 호출 자체는 R2에 요청을 보내지 않는다(작업 수에 안 잡힌다). */
async function signUpload(
    /** @type {string} */ key,
    /** @type {string} */ contentType,
    /** @type {number} */ expiresIn = 300,
) {
    const { client: c, bucket } = requireR2();
    return getSignedUrl(c, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), { expiresIn });
}

/** 조회용 서명 URL. <img src>에 그대로 넣는다. 만료를 짧게 둬 유출돼도 오래 쓰이지 않게 한다. */
async function signDownload(/** @type {string} */ key, /** @type {number} */ expiresIn = 600) {
    const { client: c, bucket } = requireR2();
    return getSignedUrl(c, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

/** 실제로 올라온 크기·타입을 확인한다. 브라우저가 보고한 값을 믿지 않기 위한 것. */
async function head(/** @type {string} */ key) {
    const { client: c, bucket } = requireR2();
    const r = await c.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { bytes: Number(r.ContentLength ?? 0), contentType: String(r.ContentType ?? '') };
}

/** R2에서 삭제는 무과금이다. */
async function remove(/** @type {string} */ key) {
    const { client: c, bucket } = requireR2();
    await c.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

module.exports = { isConfigured, signUpload, signDownload, head, remove };
