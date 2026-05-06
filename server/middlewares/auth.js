const jwt = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET;

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({message: '로그인이 필요합니다.'});

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({message: '유효하지 않은 토큰입니다.'});
        req.user = user;
        next();
    });
};

const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({message: '관리자 권한이 필요합니다.'});
    }
    next();
};

module.exports = {
    authenticateToken,
    requireAdmin
};