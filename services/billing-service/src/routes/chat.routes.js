// services/billing-service/src/routes/chat.routes.js
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const crypto  = require('crypto');
const { auth } = require('../middleware/auth');
const { prisma } = require('../utils/db');
const { uploadFichier } = require('../utils/storage');

// ── Multer config (pièces jointes + photo de groupe) ────────────
// Fichier gardé en mémoire puis envoyé vers Supabase Storage
const uploadChat = multer({
  storage: multer.memoryStorage(),
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
      'application/zip',
      'application/x-zip-compressed',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'text/plain',
      // Audio (messages vocaux)
      'audio/mpeg',
      'audio/mp4',
      'audio/m4a',
      'audio/x-m4a',
      'audio/aac',
      'audio/wav',
      'audio/x-wav',
      'audio/webm',
      'audio/ogg',
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Type de fichier non autorisé'), false);
  },
});

// URL du notification-service pour les push FCM (chat)
const NOTIF_URL = process.env.NOTIF_URL || 'https://notification-service-1o8a.onrender.com';

// Envoie un push FCM aux destinataires via le notification-service
const envoyerPushChat = async (tokens, titre, contenu, data = {}) => {
  const valides = (tokens || []).filter(Boolean);
  if (!valides.length) return;
  try {
    await fetch(`${NOTIF_URL}/notifications/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': process.env.INTERNAL_API_KEY || '',
      },
      body: JSON.stringify({ tokens: valides, titre, contenu, data }),
    });
  } catch (err) {
    console.warn('[Chat] Push FCM échec:', err.message);
  }
};

// Nom complet d'un expéditeur pour le contenu du push
const nomExpediteur = (u) => `${u?.prenom ?? ''} ${u?.nom ?? ''}`.trim();

// ── Support de `clientId` (idempotence des envois hors-ligne) ────
// Le client Prisma ou la base peuvent ne pas encore connaître la colonne
// `clientId` (schéma non poussé / client non régénéré). Sans ce garde-fou,
// chaque envoi échouait en 500 « Erreur serveur ». On détecte la colonne une
// seule fois : si elle manque, l'envoi reste fonctionnel et seule la
// déduplication hors-ligne est désactivée (avec un avertissement au démarrage).
let _clientIdSupporte = null;

const clientIdSupporte = async () => {
  if (_clientIdSupporte !== null) return _clientIdSupporte;
  try {
    await prisma.messageGroupe.findFirst({
      where: { clientId: null },
      select: { id: true },
    });
    _clientIdSupporte = true;
  } catch (err) {
    _clientIdSupporte = false;
    console.warn(
      '[Chat] Colonne clientId indisponible — idempotence hors-ligne désactivée. ' +
        'Lancez « prisma db push » pour l\'activer :',
      err.message
    );
  }
  return _clientIdSupporte;
};

// Normalise le clientId reçu du mobile (chaîne non vide) ou null
const normaliserClientId = (clientId) => {
  if (typeof clientId !== 'string') return null;
  const cid = clientId.trim();
  return cid.length ? cid.slice(0, 191) : null;
};

// Champs renvoyés au mobile, TOUJOURS listés explicitement (et non la
// sélection implicite de Prisma) : sur une base qui n'a pas encore la colonne
// `clientId`, une sélection implicite ferait échouer la requête en P2022.
const SELECT_USER = { select: { id: true, nom: true, prenom: true, photoUrl: true } };

const champsMessageGroupe = (avecClientId) => ({
  id: true,
  groupId: true,
  userId: true,
  texte: true,
  pieceJointe: true,
  luPar: true,
  createdAt: true,
  ...(avecClientId ? { clientId: true } : {}),
});

const champsMessagePrive = (avecClientId) => ({
  id: true,
  conversationId: true,
  userId: true,
  texte: true,
  pieceJointe: true,
  lu: true,
  createdAt: true,
  ...(avecClientId ? { clientId: true } : {}),
});

// ── Tous les utilisateurs authentifiés peuvent accéder au chat ──
router.use(auth);

// Génère un code d'invitation unique (8 caractères, ex: SC-ABC123)
const genererCodeInvitation = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans O/0/I/1 ambigus
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `SC-${code}`;
};

// ── GET /chat/groups — Lister les groupes de l'établissement ────
router.get('/groups', async (req, res) => {
  try {
    const etablissementId = req.headers['x-etab-id'];
    const userId = req.headers['x-user-id'];
    if (!etablissementId) {
      return res.status(400).json({ error: 'etablissementId requis' });
    }

    // Un groupe n'est visible que par les membres qui l'ont rejoint (via le code)
    const groupes = await prisma.groupeChat.findMany({
      where: userId
        ? { etablissementId, membres: { some: { userId } } }
        : { etablissementId },
      include: {
        _count: { select: { membres: true, messages: true } },
        // Champs explicites : la sélection implicite de Prisma inclurait
        // `clientId`, absent des bases pas encore migrées.
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { texte: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Nombre de messages non lus par groupe (pour les badges)
    // Scalaire et indexé : on compare les messages plus récents que le
    // dernier message lu par le membre (dernierMessageLuLe) — on ne recharge
    // plus tous les messages du groupe (évite la requête quadratique).
    let nonLusParGroupe = {};
    if (userId && groupes.length) {
      const mesMembres = await prisma.membreGroupe.findMany({
        where: { groupId: { in: groupes.map((g) => g.id) }, userId },
        select: { groupId: true, dernierMessageLuLe: true },
      });
      const comptages = await Promise.all(
        mesMembres.map((membre) =>
          prisma.messageGroupe.count({
            where: {
              groupId: membre.groupId,
              userId: { not: userId },
              createdAt: membre.dernierMessageLuLe
                ? { gt: membre.dernierMessageLuLe }
                : undefined,
            },
          }).then((n) => ({ groupId: membre.groupId, n }))
        )
      );
      nonLusParGroupe = Object.fromEntries(comptages.map((c) => [c.groupId, c.n]));
    }

    const result = [];
    for (const g of groupes) {
      // Backfill: les groupes créés avant la fonctionnalité n'ont pas de code
      if (!g.codeInvitation) {
        let codeInvitation = genererCodeInvitation();
        while (await prisma.groupeChat.findUnique({ where: { codeInvitation } })) {
          codeInvitation = genererCodeInvitation();
        }
        await prisma.groupeChat.update({ where: { id: g.id }, data: { codeInvitation } });
        g.codeInvitation = codeInvitation;
      }
      result.push({
        id: g.id,
        nom: g.nom,
        codeInvitation: g.codeInvitation,
        photoUrl: g.photoUrl,
        nbMembres: g._count.membres,
        nonLus: nonLusParGroupe[g.id] || 0,
        dernierMessage: g.messages[0]?.texte ?? null,
        dernierMessageLe: g.messages[0]?.createdAt ?? null,
        creeParId: g.creeParId,
        createdAt: g.createdAt,
      });
    }

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

    // Générer un code d'invitation unique
    let codeInvitation = genererCodeInvitation();
    while (await prisma.groupeChat.findUnique({ where: { codeInvitation } })) {
      codeInvitation = genererCodeInvitation();
    }

    const groupe = await prisma.groupeChat.create({
      data: {
        nom,
        codeInvitation,
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
      codeInvitation: groupe.codeInvitation,
      nbMembres: groupe._count.membres,
      creeParId: groupe.creeParId,
      createdAt: groupe.createdAt,
    });
  } catch (err) {
    console.error('[Chat] Erreur POST /groups:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── POST /chat/groups/join — Rejoindre un groupe par code d'invitation ──
router.post('/groups/join', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const etablissementId = req.headers['x-etab-id'];
    const { codeInvitation } = req.body;

    if (!userId || !etablissementId) {
      return res.status(400).json({ error: 'userId et etablissementId requis' });
    }
    if (!codeInvitation) {
      return res.status(400).json({ error: 'codeInvitation requis' });
    }

    const code = String(codeInvitation).trim().toUpperCase();

    // Vérifier que le groupe existe et appartient au MÊME établissement
    const groupe = await prisma.groupeChat.findUnique({ where: { codeInvitation: code } });
    if (!groupe) {
      return res.status(404).json({ error: 'Groupe introuvable. Vérifiez le code d\'invitation.' });
    }
    if (groupe.etablissementId !== etablissementId) {
      return res.status(403).json({ error: 'Ce groupe appartient à un autre établissement' });
    }

    // Ajouter le membre (ignorer si déjà membre)
    await prisma.membreGroupe.upsert({
      where: { groupId_userId: { groupId: groupe.id, userId } },
      create: { groupId: groupe.id, userId },
      update: {},
    });

    res.json({ success: true, groupeId: groupe.id, nom: groupe.nom });
  } catch (err) {
    console.error('[Chat] Erreur POST /groups/join:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── POST /chat/groups/:id/join — Rejoindre un groupe (par id, même établissement) ──
router.post('/groups/:id/join', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const etablissementId = req.headers['x-etab-id'];
    const { id } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'userId requis' });
    }

    // Vérifier que le groupe existe ET appartient au même établissement
    const groupe = await prisma.groupeChat.findUnique({ where: { id } });
    if (!groupe) {
      return res.status(404).json({ error: 'Groupe introuvable' });
    }
    if (etablissementId && groupe.etablissementId !== etablissementId) {
      return res.status(403).json({ error: 'Groupe d\'un autre établissement' });
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
    const etablissementId = req.headers['x-etab-id'];
    const userId = req.headers['x-user-id'];
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before; // cursor-based pagination

    // Isolation : vérifier que le groupe appartient à l'établissement de l'utilisateur
    const groupe = await prisma.groupeChat.findUnique({
      where: { id },
      select: { etablissementId: true },
    });
    if (!groupe) {
      return res.status(404).json({ error: 'Groupe introuvable' });
    }
    if (etablissementId && groupe.etablissementId !== etablissementId) {
      return res.status(403).json({ error: 'Groupe d\'un autre établissement' });
    }

    // Vérifier que l'utilisateur est membre
    if (userId) {
      const membre = await prisma.membreGroupe.findUnique({
        where: { groupId_userId: { groupId: id, userId } },
      });
      if (!membre) {
        return res.status(403).json({ error: 'Vous n\'êtes pas membre de ce groupe' });
      }
    }

    const apres = req.query.apres; // récupération incrémentale (préfixe dates identiques valides)
    const where = { groupId: id };
    if (before) {
      where.createdAt = { lt: new Date(before) };
    } else if (apres) {
      where.createdAt = { gt: new Date(apres) };
    }

    const avecClientId = await clientIdSupporte();
    const messages = await prisma.messageGroupe.findMany({
      where,
      select: {
        ...champsMessageGroupe(avecClientId),
        user: SELECT_USER,
      },
      orderBy: { createdAt: 'asc' },
      take: apres ? undefined : limit,
    });

    // Marquer les messages de groupe comme lus pour cet utilisateur
    if (userId) {
      const nonLus = messages.filter(
        (m) => m.userId !== userId && !(m.luPar || []).includes(userId)
      );
      for (const m of nonLus) {
        const luPar = m.luPar || [];
        await prisma.messageGroupe.update({
          where: { id: m.id },
          data: { luPar: [...luPar, userId] },
          select: { id: true }, // sélection minimale (évite toute colonne absente)
        });
      }
      // Met à jour le curseur de lecture du membre → permet un comptage
      // scalaire des non-lus (GET /groups) sans recharger tous les messages.
      if (messages.length) {
        const dernier = messages[messages.length - 1];
        await prisma.membreGroupe.updateMany({
          where: { groupId: id, userId },
          data: { dernierMessageLuLe: dernier.createdAt },
        });
      }
    }

    res.json({ messages });
  } catch (err) {
    console.error('[Chat] Erreur GET /groups/:id/messages:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── POST /chat/groups/:id/messages — Envoyer un message ─────────
router.post('/groups/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.headers['x-user-id'];
    const etablissementId = req.headers['x-etab-id'];
    const { texte, pieceJointe, clientId } = req.body;

    if ((!texte || !texte.trim()) && !pieceJointe) {
      return res.status(400).json({ error: 'texte ou pièce jointe requis' });
    }
    if (!userId) {
      return res.status(400).json({ error: 'userId requis' });
    }

    console.log('[Chat] POST /groups/:id/messages', { groupId: id, userId, texte: (texte || '').slice(0, 50), clientId });

    // Isolation : vérifier que le groupe appartient à l'établissement de l'utilisateur
    const groupe = await prisma.groupeChat.findUnique({
      where: { id },
      select: { etablissementId: true, nom: true },
    });
    if (!groupe) {
      return res.status(404).json({ error: 'Groupe introuvable' });
    }
    if (etablissementId && groupe.etablissementId !== etablissementId) {
      return res.status(403).json({ error: 'Groupe d\'un autre établissement' });
    }

    // Vérifier que l'utilisateur est membre
    const membre = await prisma.membreGroupe.findUnique({
      where: { groupId_userId: { groupId: id, userId } },
    });

    if (!membre) {
      return res.status(403).json({ error: 'Vous n\'êtes pas membre de ce groupe' });
    }

    // Idempotence : un rejeu du même message (file hors-ligne) ne doit pas
    // créer de doublon. On interroge par (groupId, clientId) — cette paire est
    // aussi protégée par la contrainte @@unique([groupId, clientId]).
    const avecClientId = await clientIdSupporte();
    const cid = avecClientId ? normaliserClientId(clientId) : null;
    const selection = {
      ...champsMessageGroupe(avecClientId),
      user: SELECT_USER,
    };

    if (cid) {
      const existing = await prisma.messageGroupe.findFirst({
        where: { groupId: id, clientId: cid },
        select: selection,
      });
      if (existing) {
        console.log('[Chat] Message déjà présent (clientId):', cid);
        return res.status(200).json(existing);
      }
    }

    let message;
    try {
      message = await prisma.messageGroupe.create({
        data: {
          groupId: id,
          userId,
          ...(cid ? { clientId: cid } : {}),
          texte: texte || '',
          pieceJointe: pieceJointe || undefined,
          luPar: [userId], // l'expéditeur a déjà "lu" son propre message
        },
        select: selection,
      });
    } catch (err) {
      // Course entre deux envois du même message (contrainte unique) :
      // on renvoie le message déjà enregistré plutôt qu'une erreur 500.
      if (err.code === 'P2002' && cid) {
        const existant = await prisma.messageGroupe.findFirst({
          where: { groupId: id, clientId: cid },
          select: selection,
        });
        if (existant) {
          console.log('[Chat] Message déjà créé (course clientId):', cid);
          return res.status(200).json(existant);
        }
      }
      throw err;
    }
    console.log('[Chat] Message créé:', message.id);

    // ── Push FCM aux autres membres du groupe ──
    try {
      const membres = await prisma.membreGroupe.findMany({
        where: { groupId: id, userId: { not: userId } },
        select: { user: { select: { fcmToken: true } } },
      });
      const tokens = membres.map((m) => m.user.fcmToken).filter(Boolean);
      envoyerPushChat(
        tokens,
        `Nouveau message dans ${groupe.nom}`,
        `${nomExpediteur(message.user)}: ${(texte || '').slice(0, 100)}`,
        { type: 'chat_groupe', groupeId: id }
      );
    } catch (pushErr) {
      console.warn('[Chat] Push groupe échec:', pushErr.message);
    }

    res.status(201).json(message);
  } catch (err) {
    console.error('[Chat] Erreur POST /groups/:id/messages:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── DELETE /chat/groups/:id — Supprimer un groupe (créateur uniquement) ──
router.delete('/groups/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { id } = req.params;

    const groupe = await prisma.groupeChat.findUnique({ where: { id } });
    if (!groupe) {
      return res.status(404).json({ error: 'Groupe introuvable' });
    }

    // Seul le créateur peut supprimer le groupe
    if (groupe.creeParId !== userId) {
      return res.status(403).json({ error: 'Seul le créateur du groupe peut le supprimer' });
    }

    await prisma.groupeChat.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error('[Chat] Erreur DELETE /groups/:id:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════
// CHAT PRIVÉ (1-à-1, même établissement)
// ══════════════════════════════════════════════════════════════════

// Normalise l'ordre des deux participants (userA = id lexicographiquement plus petit)
const pairesConversation = (a, b) => (a < b ? [a, b] : [b, a]);

// ── GET /chat/utilisateurs — Tous les utilisateurs de l'établissement ──
router.get('/utilisateurs', async (req, res) => {
  try {
    const etablissementId = req.headers['x-etab-id'];
    const userId = req.headers['x-user-id'];
    if (!etablissementId) {
      return res.status(400).json({ error: 'etablissementId requis' });
    }

    const utilisateurs = await prisma.user.findMany({
      where: { etablissementId },
      select: {
        id: true,
        nom: true,
        prenom: true,
        email: true,
        role: true,
        photoUrl: true,
        classeEtudiantId: true,
      },
      orderBy: { prenom: 'asc' },
    });

    const result = utilisateurs
      .filter((u) => u.id !== userId)
      .map((u) => ({
        id: u.id,
        nom: u.nom,
        prenom: u.prenom,
        email: u.email,
        role: u.role,
        photoUrl: u.photoUrl,
      }));

    res.json({ utilisateurs: result });
  } catch (err) {
    console.error('[Chat] Erreur GET /utilisateurs:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── GET /chat/privates — Liste des conversations privées de l'utilisateur ──
router.get('/privates', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const etablissementId = req.headers['x-etab-id'];
    if (!userId) {
      return res.status(400).json({ error: 'userId requis' });
    }

    const conversations = await prisma.conversationPrivee.findMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
        ...(etablissementId ? { etablissementId } : {}),
      },
      include: {
        initiateur: { select: { id: true, nom: true, prenom: true, photoUrl: true } },
        invite: { select: { id: true, nom: true, prenom: true, photoUrl: true } },
        // Champs explicites : la sélection implicite de Prisma inclurait
        // `clientId`, absent des bases pas encore migrées.
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { texte: true, createdAt: true, userId: true, lu: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const result = conversations.map((c) => {
      const autre =
        c.userAId === userId ? c.invite : c.initiateur;
      const dernier = c.messages[0] ?? null;
      return {
        id: c.id,
        autreId: autre.id,
        autreNom: autre.nom,
        autrePrenom: autre.prenom,
        autrePhotoUrl: autre.photoUrl,
        dernierMessage: dernier?.texte ?? null,
        dernierMessageLe: dernier?.createdAt ?? null,
        dernierMessageDeMoi: dernier ? dernier.userId === userId : false,
        nonLus: dernier && !dernier.lu && dernier.userId !== userId ? 1 : 0,
      };
    });

    res.json({ conversations: result });
  } catch (err) {
    console.error('[Chat] Erreur GET /privates:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── POST /chat/privates — Créer / retrouver une conversation avec un utilisateur ──
router.post('/privates', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const etablissementId = req.headers['x-etab-id'];
    const { autreId } = req.body;

    if (!userId || !autreId || !etablissementId) {
      return res.status(400).json({ error: 'userId, autreId et etablissementId requis' });
    }
    if (userId === autreId) {
      return res.status(400).json({ error: 'Impossible de discuter avec soi-même' });
    }

    // Vérifier que l'autre utilisateur appartient au même établissement
    const autre = await prisma.user.findUnique({
      where: { id: autreId },
      select: { etablissementId: true },
    });
    if (!autre || autre.etablissementId !== etablissementId) {
      return res.status(403).json({ error: 'Utilisateur hors de votre établissement' });
    }

    const [a, b] = pairesConversation(userId, autreId);
    const conversation = await prisma.conversationPrivee.upsert({
      where: { userAId_userBId: { userAId: a, userBId: b } },
      create: { userAId: a, userBId: b, etablissementId },
      update: {},
    });

    res.status(201).json({ conversation: { id: conversation.id } });
  } catch (err) {
    console.error('[Chat] Erreur POST /privates:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── GET /chat/privates/:id/messages — Lister les messages privés ──
router.get('/privates/:id/messages', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { id } = req.params;
    if (!userId) {
      return res.status(400).json({ error: 'userId requis' });
    }

    const conversation = await prisma.conversationPrivee.findUnique({ where: { id } });
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation introuvable' });
    }
    if (conversation.userAId !== userId && conversation.userBId !== userId) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const apres = req.query.apres; // récupération incrémentale
    const avecClientId = await clientIdSupporte();
    const messages = await prisma.messagePrive.findMany({
      where: {
        conversationId: id,
        ...(apres ? { createdAt: { gt: new Date(apres) } } : {}),
      },
      select: {
        ...champsMessagePrive(avecClientId),
        user: SELECT_USER,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Marquer les messages reçus comme lus
    await prisma.messagePrive.updateMany({
      where: { conversationId: id, userId: { not: userId }, lu: false },
      data: { lu: true },
    });

    res.json({ messages });
  } catch (err) {
    console.error('[Chat] Erreur GET /privates/:id/messages:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── POST /chat/privates/:id/messages — Envoyer un message privé ──
router.post('/privates/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.headers['x-user-id'];
    const etablissementId = req.headers['x-etab-id'];
    const { texte, pieceJointe, clientId } = req.body;

    if ((!texte || !texte.trim()) && !pieceJointe) {
      return res.status(400).json({ error: 'texte ou pièce jointe requis' });
    }
    if (!userId) {
      return res.status(400).json({ error: 'userId requis' });
    }

    console.log('[Chat] POST /privates/:id/messages', { conversationId: id, userId, texte: (texte || '').slice(0, 50), clientId });

    const conversation = await prisma.conversationPrivee.findUnique({ where: { id } });
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation introuvable' });
    }
    if (conversation.userAId !== userId && conversation.userBId !== userId) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    // Idempotence : un rejeu du même message (file hors-ligne) ne doit pas
    // créer de doublon. On interroge par (conversationId, clientId) — cette
    // paire est aussi protégée par @@unique([conversationId, clientId]).
    const avecClientId = await clientIdSupporte();
    const cid = avecClientId ? normaliserClientId(clientId) : null;
    const selection = {
      ...champsMessagePrive(avecClientId),
      user: SELECT_USER,
    };

    if (cid) {
      const existing = await prisma.messagePrive.findFirst({
        where: { conversationId: id, clientId: cid },
        select: selection,
      });
      if (existing) {
        console.log('[Chat] Message privé déjà présent (clientId):', cid);
        return res.status(200).json(existing);
      }
    }

    let message;
    try {
      message = await prisma.messagePrive.create({
        data: {
          conversationId: id,
          userId,
          ...(cid ? { clientId: cid } : {}),
          texte: texte || '',
          pieceJointe: pieceJointe || undefined,
        },
        select: selection,
      });
    } catch (err) {
      // Course entre deux envois du même message (contrainte unique) :
      // on renvoie le message déjà enregistré plutôt qu'une erreur 500.
      if (err.code === 'P2002' && cid) {
        const existant = await prisma.messagePrive.findFirst({
          where: { conversationId: id, clientId: cid },
          select: selection,
        });
        if (existant) {
          console.log('[Chat] Message privé déjà créé (course clientId):', cid);
          return res.status(200).json(existant);
        }
      }
      throw err;
    }
    console.log('[Chat] Message privé créé:', message.id);

    await prisma.conversationPrivee.update({ where: { id }, data: { updatedAt: new Date() } });

    // ── Push FCM à l'autre participant ──
    try {
      const autreId =
        conversation.userAId === userId ? conversation.userBId : conversation.userAId;
      const autre = await prisma.user.findUnique({
        where: { id: autreId },
        select: { fcmToken: true },
      });
      if (autre?.fcmToken) {
        envoyerPushChat(
          [autre.fcmToken],
          'Nouveau message',
          `${nomExpediteur(message.user)}: ${(texte || '').slice(0, 100)}`,
          { type: 'chat_prive', conversationId: id }
        );
      }
    } catch (pushErr) {
      console.warn('[Chat] Push privé échec:', pushErr.message);
    }

    res.status(201).json(message);
  } catch (err) {
    console.error('[Chat] Erreur POST /privates/:id/messages:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── GET /chat/non-lus — Nombre total de messages non lus (privés + groupes) ──
router.get('/non-lus', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(400).json({ error: 'userId requis' });
    }

    // Messages privés non lus (adressés à l'utilisateur)
    const conversations = await prisma.conversationPrivee.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      select: { id: true },
    });
    const convIds = conversations.map((c) => c.id);

    const privatesNonLus = convIds.length
      ? await prisma.messagePrive.count({
          where: { conversationId: { in: convIds }, userId: { not: userId }, lu: false },
        })
      : 0;

    // Messages de groupe non lus (l'utilisateur n'est pas dans luPar)
    const groupes = await prisma.membreGroupe.findMany({
      where: { userId },
      select: { groupId: true },
    });
    const groupeIds = groupes.map((g) => g.groupId);

    // Comptage scalaire et indexé grâce à dernierMessageLuLe (évite de recharger
    // tous les messages du groupe pour compter les non-lus).
    let groupesNonLus = 0;
    if (groupeIds.length) {
      const mesMembres = await prisma.membreGroupe.findMany({
        where: { groupId: { in: groupeIds }, userId },
        select: { groupId: true, dernierMessageLuLe: true },
      });
      const comptages = await Promise.all(
        mesMembres.map((membre) =>
          prisma.messageGroupe.count({
            where: {
              groupId: membre.groupId,
              userId: { not: userId },
              createdAt: membre.dernierMessageLuLe
                ? { gt: membre.dernierMessageLuLe }
                : undefined,
            },
          })
        )
      );
      groupesNonLus = comptages.reduce((a, b) => a + b, 0);
    }

    res.json({ count: privatesNonLus + groupesNonLus });
  } catch (err) {
    console.error('[Chat] Erreur GET /non-lus:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════
// PIÈCES JOINTES & PHOTO DE GROUPE & SUPPRESSIONS
// ══════════════════════════════════════════════════════════════════

// ── POST /chat/groups/:id/pieces-jointes — Upload d'un fichier ──
router.post('/groups/:id/pieces-jointes', uploadChat.single('fichier'), async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { id } = req.params;
    if (!userId) return res.status(400).json({ error: 'userId requis' });

    // Vérifier que le groupe existe et que l'utilisateur est membre
    const groupe = await prisma.groupeChat.findUnique({ where: { id } });
    if (!groupe) return res.status(404).json({ error: 'Groupe introuvable' });
    const membre = await prisma.membreGroupe.findUnique({
      where: { groupId_userId: { groupId: id, userId } },
    });
    if (!membre) return res.status(403).json({ error: 'Vous n\'êtes pas membre de ce groupe' });

    if (!req.file) return res.status(400).json({ error: 'Fichier manquant' });

    const url = await uploadFichier({
      buffer: req.file.buffer,
      nom: `${crypto.randomBytes(8).toString('hex')}${path.extname(req.file.originalname)}`,
      dossier: 'chat',
      contentType: req.file.mimetype,
    });

    res.status(201).json({
      nom: req.file.originalname,
      url,
      taille: req.file.size,
      type: req.file.mimetype,
    });
  } catch (err) {
    console.error('[Chat] Erreur upload groupe:', err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

// ── POST /chat/privates/:id/pieces-jointes — Upload d'un fichier ──
router.post('/privates/:id/pieces-jointes', uploadChat.single('fichier'), async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { id } = req.params;
    if (!userId) return res.status(400).json({ error: 'userId requis' });

    const conversation = await prisma.conversationPrivee.findUnique({ where: { id } });
    if (!conversation) return res.status(404).json({ error: 'Conversation introuvable' });
    if (conversation.userAId !== userId && conversation.userBId !== userId) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    if (!req.file) return res.status(400).json({ error: 'Fichier manquant' });

    const url = await uploadFichier({
      buffer: req.file.buffer,
      nom: `${crypto.randomBytes(8).toString('hex')}${path.extname(req.file.originalname)}`,
      dossier: 'chat',
      contentType: req.file.mimetype,
    });

    res.status(201).json({
      nom: req.file.originalname,
      url,
      taille: req.file.size,
      type: req.file.mimetype,
    });
  } catch (err) {
    console.error('[Chat] Erreur upload privé:', err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

// ── PATCH /chat/groups/:id/photo — Photo de profil du groupe (créateur) ──
router.patch('/groups/:id/photo', uploadChat.single('photo'), async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { id } = req.params;
    if (!userId) return res.status(400).json({ error: 'userId requis' });

    const groupe = await prisma.groupeChat.findUnique({ where: { id } });
    if (!groupe) return res.status(404).json({ error: 'Groupe introuvable' });
    if (groupe.creeParId !== userId) {
      return res.status(403).json({ error: 'Seul le créateur peut modifier la photo' });
    }
    if (!req.file) return res.status(400).json({ error: 'Photo manquante' });

    const photoUrl = await uploadFichier({
      buffer: req.file.buffer,
      nom: `${crypto.randomBytes(8).toString('hex')}${path.extname(req.file.originalname)}`,
      dossier: 'chat',
      contentType: req.file.mimetype,
    });
    await prisma.groupeChat.update({ where: { id }, data: { photoUrl } });
    res.json({ photoUrl });
  } catch (err) {
    console.error('[Chat] Erreur photo groupe:', err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

// ── DELETE /chat/groups/:id/messages/:messageId — Supprimer un message (auteur) ──
router.delete('/groups/:id/messages/:messageId', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { id, messageId } = req.params;
    if (!userId) return res.status(400).json({ error: 'userId requis' });

    const message = await prisma.messageGroupe.findUnique({
      where: { id: messageId },
      select: { id: true, groupId: true, userId: true },
    });
    if (!message || message.groupId !== id) {
      return res.status(404).json({ error: 'Message introuvable' });
    }
    if (message.userId !== userId) {
      return res.status(403).json({ error: 'Seul l\'auteur du message peut le supprimer' });
    }

    await prisma.messageGroupe.delete({
      where: { id: messageId },
      select: { id: true },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[Chat] Erreur DELETE message groupe:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── DELETE /chat/privates/:id/messages/:messageId — Supprimer un message (auteur) ──
router.delete('/privates/:id/messages/:messageId', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { id, messageId } = req.params;
    if (!userId) return res.status(400).json({ error: 'userId requis' });

    const message = await prisma.messagePrive.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true, userId: true },
    });
    if (!message || message.conversationId !== id) {
      return res.status(404).json({ error: 'Message introuvable' });
    }
    if (message.userId !== userId) {
      return res.status(403).json({ error: 'Seul l\'auteur du message peut le supprimer' });
    }

    await prisma.messagePrive.delete({
      where: { id: messageId },
      select: { id: true },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[Chat] Erreur DELETE message privé:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── DELETE /chat/privates/:id — Supprimer la conversation (participant) ──
router.delete('/privates/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { id } = req.params;
    if (!userId) return res.status(400).json({ error: 'userId requis' });

    const conversation = await prisma.conversationPrivee.findUnique({ where: { id } });
    if (!conversation) return res.status(404).json({ error: 'Conversation introuvable' });
    if (conversation.userAId !== userId && conversation.userBId !== userId) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    // Supprime la conversation + ses messages (cascade)
    await prisma.conversationPrivee.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error('[Chat] Erreur DELETE conversation:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
