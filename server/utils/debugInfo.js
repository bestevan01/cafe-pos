// 에러 메시지를 개발 환경에서만 클라이언트에 노출하기 위한 헬퍼.
// 운영(production)에서는 undefined를 반환하며, JSON 직렬화 시 키 자체가 빠집니다.
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/** @param {any} err */
module.exports = (err) => (IS_PRODUCTION ? undefined : err && err.message);
