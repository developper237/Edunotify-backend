// services/auth-service/src/config/upload.js
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const dossierLogos = path.join(__dirname, '..', '..', 'uploads', 'logos');
const dossierAvatars = path.join(__dirname, '..', '..', 'uploads', 'avatars');
fs.mkdirSync(dossierLogos, { recursive: true });
fs.mkdirSync(dossierAvatars, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Photos de profil → dossier avatars ; sinon logos
    if (file.fieldname === 'photo') return cb(null, dossierAvatars);
    cb(null, dossierLogos);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    if (file.fieldname === 'photo') {
      // userId dans le nom du fichier -> écrase l'ancienne photo à chaque upload
      cb(null, `avatar-${req.user.id}${ext}`);
    } else {
      // etablissementId dans le nom du fichier -> écrase l'ancien logo à chaque upload
      cb(null, `${req.user.etablissementId}${ext}`);
    }
  },
});

const fileFilter = (req, file, cb) => {
  const typesAutorises = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  if (typesAutorises.includes(file.mimetype)) return cb(null, true);
  cb(new Error('Format d\'image non supporté (png, jpg, webp uniquement)'));
};

module.exports = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 Mo max
});