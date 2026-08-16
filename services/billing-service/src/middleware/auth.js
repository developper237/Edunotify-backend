// services/billing-service/src/middleware/auth.js
// Lit les headers posés par la gateway (après vérification du JWT).

const auth = (req, res, next) => {
  req.user = {
    id:              req.headers['x-user-id'],
    role:            req.headers['x-user-role'],
    etablissementId: req.headers['x-etab-id']   || null,
    departementId:   req.headers['x-dept-id']   || null,
    classeId:        req.headers['x-classe-id'] || null,
  };
  if (!req.user.id) return res.status(401).json({ error: 'Non authentifié' });
  next();
};

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role))
    return res.status(403).json({ error: 'Accès refusé' });
  next();
};

module.exports = { auth, requireRole };
