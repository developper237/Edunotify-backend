// services/auth-service/src/config/upload.js
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const dossierLogos = path.join(__dirname, '..', '..', 'uploads', 'logos');
fs.mkdirSync(dossierLogos, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, dossierLogos),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    // etablissementId dans le nom du fichier -> écrase l'ancien logo à chaque upload
    cb(null, `${req.user.etablissementId}${ext}`);
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