// 어떤 라우트에도 매칭되지 않은 요청을 처리하는 404 핸들러.
// 모든 라우트 등록 이후, 에러 핸들러 직전에 위치해야 합니다.
/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
module.exports = (req, res) => {
    res.status(404).json({ success: false, message: '요청하신 경로를 찾을 수 없습니다.' });
};
