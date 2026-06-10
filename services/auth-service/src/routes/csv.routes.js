// services/auth-service/src/routes/csv.routes.js

const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const CsvController = require('../controllers/csv.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' ||
        file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers CSV sont acceptés'));
    }
  },
});

// POST /auth/csv/import
// Délégué importe la liste de sa classe
router.post('/import',
  authenticate,
  requireRole('delegue'),
  upload.single('fichier'),
  CsvController.importerEtudiants
);

// GET /auth/csv/template
// Télécharger le modèle CSV
router.get('/template', authenticate, CsvController.getTemplate);

// GET /auth/csv/classe/:classeId
// Voir la liste des étudiants d'une classe
router.get('/classe/:classeId',
  authenticate,
  requireRole('delegue', 'chef_departement', 'admin'),
  CsvController.getEtudiantsClasse
);

module.exports = router;
