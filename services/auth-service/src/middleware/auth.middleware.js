// services/auth-service/src/middleware/auth.middleware.js

const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expiré', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token invalide' });
  }
    if (decoded.etablissementId) {
    const etab = await prisma.etablissement.findUnique({
      where:  { id: decoded.etablissementId },
      select: { actif: true },
    });
    if (!etab || !etab.actif) {
      return res.status(403).json({
        error: 'Votre établissement a été suspendu. Contactez votre administrateur.',
        code:  'ETABLISSEMENT_SUSPENDU',
      });
    }
  }

  req.user = decoded;
  next();

};

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      error: `Accès refusé. Rôle requis : ${roles.join(' ou ')}`,
    });
  }
  next();
};

module.exports = { authenticate, requireRole };
