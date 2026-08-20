// services/billing-service/src/routes/library.routes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const { auth } = require('../middleware/auth');
const ctrl = require('../controllers/library.controller');

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
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
router.use(auth);

router.get('/documents', ctrl.listerDocuments);
router.post('/documents', upload.single('fichier'), ctrl.uploaderDocument);
router.get('/documents/:id', ctrl.getDocument);
router.get('/documents/:id/telecharger', ctrl.telechargerDocument);
router.delete('/documents/:id', ctrl.supprimerDocument);

module.exports = router;
