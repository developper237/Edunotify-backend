// services/billing-service/src/controllers/library.controller.js
const { prisma } = require('../utils/db');
const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '../../uploads');
const MAX_TAILLE = 20 * 1024 * 1024; // 20 MO

// Assurer que le dossier uploads existe
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ──────────────────────────────────────────────────────────────────
// GET /library/documents — Lister les documents (avec filtres)
// ──────────────────────────────────────────────────────────────────

const listerDocuments = async (req, res) => {
  try {
    const etabId = req.user.etablissementId;
    if (!etabId) return res.status(400).json({ error: 'etablissementId requis' });

    const { search, categorie, page = 1, limit = 20 } = req.query;
    const skip = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const take = Math.min(100, parseInt(limit));

    const where = { etablissementId: etabId };
    if (categorie && categorie !== 'tous') where.categorie = categorie;
    if (search) {
      where.OR = [
        { nom: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where,
        include: { uploadePar: { select: { id: true, nom: true, prenom: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.document.count({ where }),
    ]);

    return res.json({
      documents,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / take),
    });
  } catch (err) {
    console.error('[listerDocuments]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// POST /library/documents — Uploader un document
// ──────────────────────────────────────────────────────────────────

const uploaderDocument = async (req, res) => {
  try {
    const etabId = req.user.etablissementId;
    const userId = req.user.id;
    if (!etabId || !userId) return res.status(400).json({ error: 'Identifiants requis' });

    if (!req.file) return res.status(400).json({ error: 'Aucun fichier fourni' });
    if (req.file.size > MAX_TAILLE) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Le fichier dépasse 20 Mo' });
    }

    const categorie = req.body.categorie || 'autre';
    const description = req.body.description || null;
    const nom = req.file.originalname;

    const doc = await prisma.document.create({
      data: {
        nom,
        description,
        categorie,
        typeFichier: req.file.mimetype,
        tailleOctets: req.file.size,
        urlFichier: `/uploads/${req.file.filename}`,
        etablissementId: etabId,
        uploadeParId: userId,
      },
      include: { uploadePar: { select: { id: true, nom: true, prenom: true } } },
    });

    return res.status(201).json({ document: doc });
  } catch (err) {
    console.error('[uploaderDocument]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// GET /library/documents/:id — Détails d'un document
// ──────────────────────────────────────────────────────────────────

const getDocument = async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({
      where: { id: req.params.id },
      include: { uploadePar: { select: { id: true, nom: true, prenom: true } } },
    });
    if (!doc) return res.status(404).json({ error: 'Document introuvable' });
    return res.json({ document: doc });
  } catch (err) {
    console.error('[getDocument]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// GET /library/documents/:id/telecharger — Télécharger
// ──────────────────────────────────────────────────────────────────

const telechargerDocument = async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: 'Document introuvable' });

    await prisma.document.update({
      where: { id: doc.id },
      data: { nbTelechargements: { increment: 1 } },
    });

    const filePath = path.join(__dirname, '../..', doc.urlFichier);
    return res.download(filePath, doc.nom);
  } catch (err) {
    console.error('[telechargerDocument]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// DELETE /library/documents/:id — Supprimer un document
// ──────────────────────────────────────────────────────────────────

const supprimerDocument = async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: 'Document introuvable' });

    const userId = req.user.id;
    const role = req.user.role;
    if (doc.uploadeParId !== userId && !['admin', 'super_admin', 'chef_departement'].includes(role)) {
      return res.status(403).json({ error: 'Non autorisé' });
    }

    const filePath = path.join(__dirname, '../..', doc.urlFichier);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await prisma.document.delete({ where: { id: doc.id } });
    return res.json({ message: 'Document supprimé' });
  } catch (err) {
    console.error('[supprimerDocument]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

module.exports = {
  listerDocuments,
  uploaderDocument,
  getDocument,
  telechargerDocument,
  supprimerDocument,
};
