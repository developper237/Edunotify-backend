// services/billing-service/src/routes/chat.routes.js
const express = require('express');
const router  = express.Router();
const { auth } = require('../middleware/auth');
const { prisma } = require('../utils/db');

// ── Tous les utilisateurs authentifiés peuvent accéder au chat ──
router.use(auth);

// ── GET /chat/groups — Lister les groupes de l'établissement ────
router.get('/groups', async (req, res) => {
  try {
    const etablissementId = req.headers['x-etab-id'];
    if (!etablissementId) {
      return res.status(400).json({ error: 'etablissementId requis' });
    }

    const groupes = await prisma.groupeChat.findMany({
      where: { etablissementId },
      include: {
        _count: { select: { membres: true, messages: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = groupes.map((g) => ({
      id: g.id,
      nom: g.nom,
      nbMembres: g._count.membres,
      dernierMessage: g.messages[0]?.texte ?? null,
      dernierMessageLe: g.messages[0]?.createdAt ?? null,
      creeParId: g.creeParId,
      createdAt: g.createdAt,
    }));

    res.json({ groupes: result });
  } catch (err) {
    console.error('[Chat] Erreur GET /groups:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── POST /chat/groups — Créer un groupe ─────────────────────────
router.post('/groups', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const etablissementId = req.headers['x-etab-id'];
    const { nom } = req.body;

    if (!nom || !etablissementId || !userId) {
      return res.status(400).json({ error: 'nom, etablissementId et userId requis' });
    }

    const groupe = await prisma.groupeChat.create({
      data: {
        nom,
        etablissementId,
        creeParId: userId,
        membres: {
          create: { userId },
        },
      },
      include: {
        _count: { select: { membres: true } },
      },
    });

    res.status(201).json({
      id: groupe.id,
      nom: groupe.nom,
      nbMembres: groupe._count.membres,
      creeParId: groupe.creeParId,
      createdAt: groupe.createdAt,
    });
  } catch (err) {
    console.error('[Chat] Erreur POST /groups:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── POST /chat/groups/:id/join — Rejoindre un groupe ────────────
router.post('/groups/:id/join', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { id } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'userId requis' });
    }

    // Vérifier que le groupe existe
    const groupe = await prisma.groupeChat.findUnique({ where: { id } });
    if (!groupe) {
      return res.status(404).json({ error: 'Groupe introuvable' });
    }

    // Ajouter le membre (ignorer si déjà membre)
    await prisma.membreGroupe.upsert({
      where: { groupId_userId: { groupId: id, userId } },
      create: { groupId: id, userId },
      update: {},
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[Chat] Erreur POST /groups/:id/join:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── GET /chat/groups/:id/messages — Lister les messages ─────────
router.get('/groups/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before; // cursor-based pagination

    const where = { groupId: id };
    if (before) {
      where.createdAt = { lt: new Date(before) };
    }

    const messages = await prisma.messageGroupe.findMany({
      where,
      include: {
        user: { select: { id: true, nom: true, prenom: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    res.json({ messages });
  } catch (err) {
    console.error('[Chat] Erreur GET /groups/:id/messages:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── POST /chat/groups/:id/messages — Envoyer un message ─────────
router.post('/groups/:id/messages', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { id } = req.params;
    const { texte } = req.body;

    if (!texte || !userId) {
      return res.status(400).json({ error: 'texte et userId requis' });
    }

    // Vérifier que le groupe existe et que l'utilisateur est membre
    const membre = await prisma.membreGroupe.findUnique({
      where: { groupId_userId: { groupId: id, userId } },
    });

    if (!membre) {
      return res.status(403).json({ error: 'Vous n\'êtes pas membre de ce groupe' });
    }

    const message = await prisma.messageGroupe.create({
      data: {
        groupId: id,
        userId,
        texte,
      },
      include: {
        user: { select: { id: true, nom: true, prenom: true } },
      },
    });

    res.status(201).json(message);
  } catch (err) {
    console.error('[Chat] Erreur POST /groups/:id/messages:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── DELETE /chat/groups/:id — Supprimer un groupe (créateur/admin) ──
router.delete('/groups/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const role = req.headers['x-user-role'];
    const { id } = req.params;

    const groupe = await prisma.groupeChat.findUnique({ where: { id } });
    if (!groupe) {
      return res.status(404).json({ error: 'Groupe introuvable' });
    }

    // Seul le créateur ou un admin peut supprimer
    if (groupe.creeParId !== userId && !['admin', 'super_admin'].includes(role)) {
      return res.status(403).json({ error: 'Non autorisé' });
    }

    await prisma.groupeChat.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error('[Chat] Erreur DELETE /groups/:id:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
