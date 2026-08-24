// services/auth-service/src/config/upload.js
const multer = require('multer');

// On garde le fichier en mémoire (buffer) : il est ensuite envoyé
// vers Supabase Storage (utils/storage.js), ou écrit sur le disque
// local en repli de développement.
const storage = multer.memoryStorage();

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