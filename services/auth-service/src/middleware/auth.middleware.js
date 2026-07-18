// services/auth-service/src/middleware/auth.middleware.js

const jwt = require('jsonwebtoken');
const prisma = require('../../../shared/prisma/client'); // Vérifie bien ce chemin

const authenticate = async (req, res, next) => { // AJOUT DE ASYNC ICI
  const header = req.headers.authorization;
  
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  const token = header.split(' ')[1];

  try {
    // 1. Vérification du JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // 2. Vérification de l'établissement (Sécurité Anti-Suspension)
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

    // 3. On attache le payload à la requête et on passe au controller
    req.user = decoded;
    next();

  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expiré', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token invalide' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({
      error: `Accès refusé. Rôle requis : ${roles.join(' ou ')}`,
    });
  }
  next();
};

module.exports = { authenticate, requireRole };