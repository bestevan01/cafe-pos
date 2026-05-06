module.exports = (err, req, res) => {
    console.error('[🚨 전역 에러 발생]', err);
    res.status(500).json({success: false, message: '서버 내부 오류가 발생했습니다.'});
};