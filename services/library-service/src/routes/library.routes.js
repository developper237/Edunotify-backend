const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const ctrl = require('../controllers/library.controller');
const { authenticate: auth } = require('../middleware/authJwt');

// ── Toutes les routes bibliothèque exigent un utilisateur authentifié ──
router.use(auth);

// ── Multer config (upload fichiers) ────────────────────────────
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (req, file, cb) => {
    const unique = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 Mo
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/jpeg',
      'image/png',
      'text/plain',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non autorisé'), false);
    }
  },
});

// ── Routes ──────────────────────────────────────────────────────

// Lister les documents (avec filtres, recherche, pagination)
router.get('/documents', ctrl.listerDocuments);

// Uploader un document (max 20 Mo)
router.post('/documents', upload.single('fichier'), ctrl.uploaderDocument);

// Détails d'un document
router.get('/documents/:id', ctrl.getDocument);

// Télécharger un document (incrémente le compteur)
router.get('/documents/:id/telecharger', ctrl.telechargerDocument);

// Supprimer un document
router.delete('/documents/:id', ctrl.supprimerDocument);

module.exports = router;
