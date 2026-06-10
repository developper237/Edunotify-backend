// services/notification-service/src/middleware/auth.middleware.js
const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
  const userId   = req.headers['x-user-id'];
  const userRole = req.headers['x-user-role'];

  if (userId && userRole) {
    req.user = {
      id:             userId,
      role:           userRole,
      etablissementId: req.headers['x-etab-id']  || null,
      departementId:  req.headers['x-dept-id']   || null,
      classeId:       req.headers['x-classe-id'] || null,
    };
    return next();
  }

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  try {
    const payload = jwt.verify(
      header.split(' ')[1], process.env.JWT_SECRET
    );
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  next();
};

module.exports = { authenticate, requireRole };
