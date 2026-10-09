const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided. Please log in.' });
  }

  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    // a temporary password must be replaced before anything else is allowed
    if (decoded.mustChange && !(req.originalUrl || '').startsWith('/api/auth/change-password') && !(req.originalUrl || '').startsWith('/api/auth/me')) {
      return res.status(403).json({ error: 'You must change your temporary password first.', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token. Please log in again.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${roles.join(' or ')}. Your role: ${req.user.role}`
      });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole };
