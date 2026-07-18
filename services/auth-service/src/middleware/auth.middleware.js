const jwt = require('jsonwebtoken');
// VÉRIFIEZ CE CHEMIN : est-ce ../config/prisma ou ../prismaClient ?
// Regardez dans vos controllers comment vous faites require('...') pour prisma
const prisma = require('../config/prisma'); 

const authenticate = async (req, res, next) => {
  const header = req.headers.authorization;
  
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  const token = header.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Vérification de l'établissement
    if (decoded.etablissementId) {
      const etab = await prisma.etablissement.findUnique({
        where:  { id: decoded.etablissementId },
        select: { actif: true },
      });

      if (!etab || !etab.actif) {
        return res.status(403).json({
          error: 'Votre établissement a été suspendu.',
          code:  'ETABLISSEMENT_SUSPENDU',
        });
      }
    }

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
    return res.status(403).json({ error: 'Accès refusé' });
  }
  next();
};

module.exports = { authenticate, requireRole };