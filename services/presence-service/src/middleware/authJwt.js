// shared/middleware/authJwt.js
//
// SOURCE DE VÉRITÉ du middleware d'authentification JWT unifié.
//
// ⚠️ IMPORTANT : ce fichier n'est PAS importé directement par les services.
// Chaque service possède sa propre copie dans src/middleware/authJwt.js, car
// `jsonwebtoken` est installé dans les node_modules de CHAQUE service (npm
// install par rootDir sur Render) et Node ne remonte pas dans les sous-dossiers
// services depuis `shared/`. Une copie locale garantit la résolution du module.
//
// Pour mettre à jour : modifiez ce fichier PUIS copiez-le dans chaque service :
//   services/{billing,presence,notification,academic,exam,library,chatbot}/
//
// Contenu identique à celui des copies locales.
const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non autorisé', code: 'AUTH_REQUIRED' });
  }

  const token = header.slice(7).trim();
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

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