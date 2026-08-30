// shared/middleware/authJwt.js
//
// Middleware d'authentification UNIFIÉ pour tous les services.
// SÉCURITÉ : le JWT Bearer est OBLIGATOIRE. L'utilisateur est extrait du
// payload vérifié — les headers x-user-* envoyés par le client sont IGNORÉS
// (ils ne servent plus qu'à d'éventuels appels internes entre services qui
// passeront par une clé d'API interne, jamais par le client).
//
// Exigences : process.env.JWT_SECRET doit être défini sur le service.
const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non autorisé', code: 'AUTH_REQUIRED' });
  }

  const token = header.slice(7).trim();
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Structure normalisée pour tous les services.
    req.user = {
      id:              payload.id,
      email:           payload.email,
      role:            payload.role,
      etablissementId: payload.etablissementId ?? null,
      departementId:   payload.departementId ?? null,
      classeId:        payload.classeId ?? null,
    };

    // Rétrocompatibilité : certains contrôleurs lisent encore req.headers.
    // On écrase TOUJOURS ces headers depuis le payload VÉRIFIÉ — le client
    // ne peut plus les forger, la seule source de vérité est le JWT.
    req.headers['x-user-id']   = String(payload.id);
    req.headers['x-user-role'] = String(payload.role);
    req.headers['x-etab-id']   = payload.etablissementId ? String(payload.etablissementId) : '';
    req.headers['x-dept-id']   = payload.departementId   ? String(payload.departementId)   : '';
    req.headers['x-classe-id'] = payload.classeId        ? String(payload.classeId)        : '';
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expiré', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token invalide', code: 'AUTH_INVALID' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  const flattened = roles.flat();
  if (!req.user || !flattened.includes(req.user.role)) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  next();
};

module.exports = { authenticate, requireRole };