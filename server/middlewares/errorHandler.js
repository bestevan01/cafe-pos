// 4번째 인자(next)가 있어야 Express가 '에러 처리 미들웨어'로 인식합니다(미사용은 의도적).
// noinspection JSUnusedLocalSymbols -- WebStorm 인스펙션용(next는 4-arity 유지에 필요)
// eslint-disable-next-line no-unused-vars
/**
 * @param {any} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
module.exports = (err, req, res, next) => {
    console.error('[🚨 전역 에러 발생]', err);
    res.status(500).json({ success: false, message: '서버 내부 오류가 발생했습니다.' });
};
