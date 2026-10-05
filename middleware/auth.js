const { verifyToken } = require('../utils/jwtHelper');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token not found, please login' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyToken(token);
    req.user = decoded; // { userId: ... }
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token is invalid or has expired' });
  }
}

module.exports = authMiddleware;