// services/auth-service/src/utils/helpers.js

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');

// ── Génération mot de passe temporaire ───────────────────────────
// Format : Edu@ + matricule ou partie de l'email
const generateTempPassword = (identifier) => {
  return `Edu@${identifier}`;
};

// ── Hash mot de passe ─────────────────────────────────────────────
const hashPassword = async (password) => {
  return bcrypt.hash(password, 12);
};

// ── Vérifier mot de passe ─────────────────────────────────────────
const verifyPassword = async (password, hash) => {
  return bcrypt.compare(password, hash);
};

// ── Générer JWT Access Token ──────────────────────────────────────
const generateAccessToken = (user) => {
  return jwt.sign(
    {
      id:              user.id,
      email:           user.email,
      role:            user.role,
      etablissementId: user.etablissementId,
      departementId:   user.departementId,
      classeId:        user.classeEtudiantId || user.classeDelegueId,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
};

// ── Générer JWT Refresh Token ─────────────────────────────────────
const generateRefreshToken = (userId) => {
  return jwt.sign(
    { id: userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
};

// ── Générer code OTP présence ─────────────────────────────────────
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// ── Sérialiser user pour réponse API ─────────────────────────────
const serializeUser = (user) => ({
  id:               user.id,
  nom:              user.nom,
  prenom:           user.prenom,
  email:            user.email,
  role:             user.role,
  statut:           user.statut,
  matricule:        user.matricule,
  etablissementId:  user.etablissementId,
  departementId:    user.departementId,
  classeId:         user.classeEtudiantId || user.classeDelegueId,
  fcmToken:         user.fcmToken,
  biometrieActivee: user.biometrieActivee,
  // Infos contextuelles
  etablissementNom: user.etablissement?.nom,
  departementNom:   user.departementChef?.nom,
  salleCode:        user.classeEtudiant?.codeGenere || user.classeDelegue?.codeGenere,
});

module.exports = {
  generateTempPassword,
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  generateOTP,
  serializeUser,
};
