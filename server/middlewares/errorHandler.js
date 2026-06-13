// 4번째 인자(next)가 있어야 Express가 '에러 처리 미들웨어'로 인식합니다.
// eslint-disable-next-line no-unused-vars
module.exports = (err, req, res, next) => {
    console.error('[🚨 전역 에러 발생]', err);
    res.status(500).json({success: false, message: '서버 내부 오류가 발생했습니다.'});
};