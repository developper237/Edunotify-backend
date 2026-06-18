// services/presence-service/src/index.js

const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const morgan    = require('morgan');
const { PrismaClient } = require('../../../node_modules/.prisma/client');
const Redis     = require('ioredis');

const app    = express();
const PORT   = process.env.PORT || 3004;
const prisma = new PrismaClient();
const redis  = new Redis(process.env.REDIS_URL);

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '20mb' })); // ← augmenté pour le PDF base64

// ── Auth middleware ───────────────────────────────────────────────
const auth = (req, res, next) => {
  req.user = {
    id:       req.headers['x-user-id'],
    role:     req.headers['x-user-role'],
    classeId: req.headers['x-classe-id'] || null,
  };
  if (!req.user.id) return res.status(401).json({ error: 'Non authentifié' });
  next();
};

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role))
    return res.status(403).json({ error: 'Accès refusé' });
  next();
};

const genOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

// ══════════════════════════════════════════════════════════════════
// DÉLÉGUÉ — Lancer un appel
// ══════════════════════════════════════════════════════════════════

app.post('/presence/sessions', auth, requireRole('delegue'), async (req, res) => {
  const { matiere, professeur, salle, type, dureeMinutes,
          gpsLat, gpsLng, rayonMetres } = req.body;

  if (!matiere || !professeur || !salle || !type)
    return res.status(400).json({ error: 'Champs obligatoires manquants' });

  try {
    const delegue = await prisma.user.findUnique({
      where:   { id: req.user.id },
      include: { classeDelegue: true },
    });

    if (!delegue?.classeDelegueId)
      return res.status(400).json({ error: 'Délégué sans classe associée' });

    const code = genOTP();
    const ttl  = (dureeMinutes || 5) * 60;

    const session = await prisma.sessionPresence.create({
      data: {
        code, matiere, professeur, salle, type,
        classeId:     delegue.classeDelegueId,
        delegueId:    req.user.id,
        dureeMinutes: dureeMinutes || 5,
        actif:        true,
        gpsLat:       gpsLat      ? parseFloat(gpsLat)      : null,
        gpsLng:       gpsLng      ? parseFloat(gpsLng)      : null,
        rayonMetres:  rayonMetres ? parseInt(rayonMetres)    : null,
      },
    });

    await redis.setex(
      `session:${code}`,
      ttl,
      JSON.stringify({
        sessionId:   session.id,
        classeId:    delegue.classeDelegueId,
        gpsLat:      gpsLat   ? parseFloat(gpsLat)   : null,
        gpsLng:      gpsLng   ? parseFloat(gpsLng)   : null,
        rayonMetres: rayonMetres ? parseInt(rayonMetres) : null,
      })
    );

    return res.status(201).json({
      session: {
        id:           session.id,
        code,
        matiere,
        professeur,
        salle,
        type,
        dureeMinutes: dureeMinutes || 5,
        ouverteLe:    session.ouverteLe,
        ttlSeconds:   ttl,
        geoActif:     !!(gpsLat && gpsLng),
        rayonMetres:  rayonMetres || null,
      },
    });
  } catch (err) {
    console.error('[Presence] Ouvrir session:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════
// DÉLÉGUÉ — Fermer une session
// ══════════════════════════════════════════════════════════════════

app.delete('/presence/sessions/:id', auth, requireRole('delegue'), async (req, res) => {
  try {
    const session = await prisma.sessionPresence.findFirst({
      where: { id: req.params.id, delegueId: req.user.id, actif: true },
      include: {
        presences: { include: { user: true } },
        classe: {
          include: {
            etudiants: {
              select: { id: true, nom: true, prenom: true, matricule: true },
            },
          },
        },
      },
    });

    if (!session)
      return res.status(404).json({ error: 'Session non trouvée' });

    await prisma.sessionPresence.update({
      where: { id: req.params.id },
      data:  { actif: false, fermeeLe: new Date() },
    });

    await redis.del(`session:${session.code}`);

    const presentsIds = new Set(session.presences.map(p => p.userId));
    const absents     = session.classe.etudiants.filter(
      e => !presentsIds.has(e.id)
    );

    if (absents.length > 0) {
      await prisma.presence.createMany({
        data: absents.map(e => ({
          sessionId: req.params.id,
          userId:    e.id,
          statut:    'absent',
        })),
        skipDuplicates: true,
      });
    }

    const presents = session.presences.map(p => ({
      id:        p.user.id,
      nom:       p.user.nom,
      prenom:    p.user.prenom,
      matricule: p.user.matricule,
      confirmeA: p.confirmeA,
    }));

    return res.json({
      message: 'Session fermée',
      rapport: {
        sessionId:    req.params.id,
        matiere:      session.matiere,
        professeur:   session.professeur,
        salle:        session.salle,
        type:         session.type,
        ouverteLe:    session.ouverteLe,
        fermeeLe:     new Date(),
        nbPresents:   presents.length,
        nbAbsents:    absents.length,
        tauxPresence: session.classe.etudiants.length > 0
          ? Math.round((presents.length / session.classe.etudiants.length) * 100)
          : 0,
        presents,
        absents: absents.map(e => ({
          id:        e.id,
          nom:       e.nom,
          prenom:    e.prenom,
          matricule: e.matricule,
        })),
      },
    });
  } catch (err) {
    console.error('[Presence] Fermer session:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════
// DÉLÉGUÉ — Session active
// ══════════════════════════════════════════════════════════════════

app.get('/presence/sessions/active', auth, requireRole('delegue'), async (req, res) => {
  try {
    const session = await prisma.sessionPresence.findFirst({
      where:   { delegueId: req.user.id, actif: true },
      include: { _count: { select: { presences: true } } },
      orderBy: { ouverteLe: 'desc' },
    });

    if (!session) return res.json({ session: null });

    const ttlRestant = await redis.ttl(`session:${session.code}`);

    if (ttlRestant <= 0) {
      await prisma.sessionPresence.update({
        where: { id: session.id },
        data:  { actif: false, fermeeLe: new Date() },
      });
      return res.json({ session: null });
    }

    return res.json({
      session: {
        id:           session.id,
        code:         session.code,
        matiere:      session.matiere,
        professeur:   session.professeur,
        salle:        session.salle,
        type:         session.type,
        ouverteLe:    session.ouverteLe,
        dureeMinutes: session.dureeMinutes,
        nbPresents:   session._count.presences,
        ttlRestant:   Math.max(0, ttlRestant),
        geoActif:     !!(session.gpsLat && session.gpsLng),
        rayonMetres:  session.rayonMetres,
        expire:       false,
      },
    });
  } catch (err) {
    console.error('[Presence] Session active délégué:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════
// DÉLÉGUÉ — Historique sessions
// ══════════════════════════════════════════════════════════════════

app.get('/presence/sessions/historique', auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });

    const where = req.user.role === 'delegue'
      ? { delegueId: req.user.id, actif: false }
      : { classe: { departementId: user.departementId }, actif: false };

    const sessions = await prisma.sessionPresence.findMany({
      where,
      include: {
        _count: { select: { presences: true } },
        classe: {
          select: {
            codeGenere: true,
            _count: { select: { etudiants: true } },
          },
        },
      },
      orderBy: { ouverteLe: 'desc' },
      take: 50,
    });

    return res.json({
      sessions: sessions.map(s => ({
        id:         s.id,
        matiere:    s.matiere,
        professeur: s.professeur,
        salle:      s.salle,
        type:       s.type,
        ouverteLe:  s.ouverteLe,
        fermeeLe:   s.fermeeLe,
        classeCode: s.classe.codeGenere,
        nbPresents: s._count.presences,
        nbTotal:    s.classe._count.etudiants,
        taux:       s.classe._count.etudiants > 0
          ? Math.round((s._count.presences / s.classe._count.etudiants) * 100)
          : 0,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════
// DÉLÉGUÉ — Détail session
// ══════════════════════════════════════════════════════════════════

app.get('/presence/sessions/:id/detail', auth, async (req, res) => {
  try {
    const session = await prisma.sessionPresence.findUnique({
      where: { id: req.params.id },
      include: {
        presences: {
          include: {
            user: { select: { id: true, nom: true, prenom: true, matricule: true } },
          },
        },
        classe: {
          include: {
            etudiants: { select: { id: true, nom: true, prenom: true, matricule: true } },
          },
        },
      },
    });

    if (!session)
      return res.status(404).json({ error: 'Session non trouvée' });

    const presentsIds = new Set(
      session.presences.filter(p => p.statut === 'present').map(p => p.userId)
    );

    const presents = session.presences
      .filter(p => p.statut === 'present')
      .map(p => ({
        id:        p.user.id,
        nom:       p.user.nom,
        prenom:    p.user.prenom,
        matricule: p.user.matricule,
        confirmeA: p.confirmeA,
        methode:   p.methode || 'code_session',
      }));

    const absents = session.classe.etudiants
      .filter(e => !presentsIds.has(e.id))
      .map(e => ({ id: e.id, nom: e.nom, prenom: e.prenom, matricule: e.matricule }));

    return res.json({
      session: {
        id:          session.id,
        matiere:     session.matiere,
        professeur:  session.professeur,
        salle:       session.salle,
        type:        session.type,
        ouverteLe:   session.ouverteLe,
        fermeeLe:    session.fermeeLe,
        nbPresents:  presents.length,
        nbAbsents:   absents.length,
        taux:        session.classe.etudiants.length > 0
          ? Math.round((presents.length / session.classe.etudiants.length) * 100)
          : 0,
        presents,
        absents,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════
// DÉLÉGUÉ — Validation manuelle
// ══════════════════════════════════════════════════════════════════

app.post('/presence/sessions/:id/valider-manuel',
  auth, requireRole('delegue'),
  async (req, res) => {
    const { matricule } = req.body;
    if (!matricule)
      return res.status(400).json({ error: 'Matricule obligatoire' });

    try {
      const session = await prisma.sessionPresence.findFirst({
        where: { id: req.params.id, delegueId: req.user.id, actif: true },
      });

      if (!session)
        return res.status(404).json({ error: 'Session non trouvée ou fermée' });

      const etudiant = await prisma.user.findFirst({
        where: { matricule, classeEtudiantId: session.classeId, role: 'etudiant' },
      });

      if (!etudiant)
        return res.status(404).json({ error: 'Étudiant introuvable dans cette classe' });

      const existing = await prisma.presence.findUnique({
        where: { sessionId_userId: { sessionId: session.id, userId: etudiant.id } },
      });

      if (existing)
        return res.status(409).json({
          error: `${etudiant.prenom} ${etudiant.nom} est déjà marqué présent`,
        });

      await prisma.presence.create({
        data: { sessionId: session.id, userId: etudiant.id, statut: 'present', methode: 'manuel' },
      });

      return res.status(201).json({
        message: `Présence de ${etudiant.prenom} ${etudiant.nom} validée`,
        etudiant: {
          id:        etudiant.id,
          nom:       etudiant.nom,
          prenom:    etudiant.prenom,
          matricule: etudiant.matricule,
        },
      });
    } catch (err) {
      console.error('[Presence] Valider manuel:', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ══════════════════════════════════════════════════════════════════
// DÉLÉGUÉ — Envoyer le rapport PDF au chef de département
// ══════════════════════════════════════════════════════════════════
//
// Body : { pdfBase64: string, nomFichier?: string }
// Le PDF est stocké dans contenu sous forme "PDF:<base64>"
// Le chef le retrouve dans ses notifications et peut l'ouvrir

app.post('/presence/sessions/:id/envoyer-rapport',
  auth, requireRole('delegue'),
  async (req, res) => {
    const { pdfBase64, nomFichier } = req.body;

    if (!pdfBase64)
      return res.status(400).json({ error: 'pdfBase64 requis' });

    try {
      // 1. Récupérer la session
      const session = await prisma.sessionPresence.findFirst({
        where:   { id: req.params.id, delegueId: req.user.id },
        include: { classe: { select: { codeGenere: true, departementId: true } } },
      });

      if (!session)
        return res.status(404).json({ error: 'Session introuvable' });

      // 2. Délégué
      const delegue = await prisma.user.findUnique({
        where:  { id: req.user.id },
        select: { nom: true, prenom: true },
      });

      // 3. ✅ Chercher UNIQUEMENT les chefs du département — requête directe
      const chefs = await prisma.user.findMany({
        where: {
          role:          'chef_departement',
          departementId: session.classe.departementId,
        },
        select: { id: true, nom: true, prenom: true, fcmToken: true },
      });

      if (chefs.length === 0)
        return res.status(404).json({ error: 'Aucun chef de département trouvé' });

      // 4. Titre du rapport
      const now      = new Date();
      const dateStr  = `${String(now.getDate()).padStart(2,'0')}-${String(now.getMonth()+1).padStart(2,'0')}-${now.getFullYear()}`;
      const fichier  = nomFichier || `Rapport_appel_${session.classe.codeGenere}_${dateStr}`;
      const titre    = `📋 ${fichier}`;

      // 5. ✅ Créer la notification SANS etablissementId
      //    pour éviter toute résolution automatique de destinataires
      const notif = await prisma.notification.create({
        data: {
          titre,
          contenu:      `PDF:${pdfBase64}`,
          categorie:    'administratif',
          urgence:      false,
          estSondage:   false,
          expediteurId: req.user.id,
          // ❌ pas d'etablissementId ici
          destinataires: {
            create: chefs.map(chef => ({ userId: chef.id })),
          },
        },
      });

      // 6. Push FCM si firebase disponible
      try {
        const { sendPushToOne } = require('./firebase');
        for (const chef of chefs) {
          if (chef.fcmToken) {
            await sendPushToOne(
              chef.fcmToken,
              '📋 Nouveau rapport d\'appel',
              `${delegue.prenom} ${delegue.nom} — ${session.matiere}`,
              { type: 'rapport_appel', notifId: notif.id },
            );
          }
        }
      } catch (_) {
        // Firebase optionnel — on ignore l'erreur
      }

      console.log(`[Presence] Rapport PDF envoyé — session ${req.params.id} → ${chefs.length} chef(s)`);

      return res.json({
        message:  `Rapport envoyé à ${chefs.length} chef(s)`,
        notifId:  notif.id,
        fichier,
        chefs:    chefs.map(c => `${c.prenom} ${c.nom}`),
      });
    } catch (err) {
      console.error('[Presence] Envoyer rapport:', err);
      return res.status(500).json({ error: 'Erreur serveur : ' + err.message });
    }
  }
);

// ══════════════════════════════════════════════════════════════════
// ÉTUDIANT — Confirmer présence
// ══════════════════════════════════════════════════════════════════

app.post('/presence/confirmer', auth, requireRole('etudiant'), async (req, res) => {
  const { code, latitude, longitude, deviceId } = req.body;
  if (!code || code.length !== 6)
    return res.status(400).json({ error: 'Code invalide' });

  try {
    const sessionData = await redis.get(`session:${code}`);
    if (!sessionData)
      return res.status(400).json({ error: 'Code invalide ou session expirée', code: 'CODE_EXPIRED' });

    const { sessionId, classeId, gpsLat, gpsLng, rayonMetres } = JSON.parse(sessionData);

    // Vérifier la classe de l'étudiant
    const classeIdEtudiant =
      req.user.classeId ||
      (await prisma.user.findUnique({
        where:  { id: req.user.id },
        select: { classeEtudiantId: true },
      }))?.classeEtudiantId;

    if (classeIdEtudiant !== classeId)
      return res.status(403).json({ error: "Ce code n'est pas destiné à votre classe" });

    // ✅ Vérifier si cet appareil a déjà confirmé pour cette session
    if (deviceId) {
      const deviceDejaUtilise = await prisma.presence.findFirst({
        where:   { sessionId, deviceId, statut: 'present' },
        include: { user: { select: { prenom: true, nom: true } } },
      });

      if (deviceDejaUtilise) {
        return res.status(409).json({
          error:    `Cet appareil a déjà confirmé la présence de ${deviceDejaUtilise.user.prenom} ${deviceDejaUtilise.user.nom} pour cette séance`,
          code:     'DEVICE_ALREADY_USED',
          etudiant: `${deviceDejaUtilise.user.prenom} ${deviceDejaUtilise.user.nom}`,
        });
      }
    }

    // Vérifier la géolocalisation si active
    let distanceM = null;
    if (gpsLat && gpsLng && rayonMetres) {
      if (!latitude || !longitude)
        return res.status(400).json({ error: 'Position GPS requise pour cette session' });

      const R    = 6371000;
      const dLat = (latitude  - gpsLat) * Math.PI / 180;
      const dLon = (longitude - gpsLng) * Math.PI / 180;
      const a    = Math.sin(dLat/2) * Math.sin(dLat/2) +
                   Math.cos(gpsLat * Math.PI / 180) * Math.cos(latitude * Math.PI / 180) *
                   Math.sin(dLon/2) * Math.sin(dLon/2);
      distanceM  = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));

      if (distanceM > rayonMetres)
        return res.status(403).json({
          error:    `Vous êtes trop loin (${distanceM}m, rayon max: ${rayonMetres}m)`,
          code:     'HORS_ZONE',
          distance: distanceM,
          rayon:    rayonMetres,
        });
    }

    const dejaConfirme = await prisma.presence.findUnique({
      where: { sessionId_userId: { sessionId, userId: req.user.id } },
    });

    if (dejaConfirme)
      return res.status(409).json({ error: 'Vous avez déjà confirmé votre présence' });

    const presence = await prisma.presence.create({
      data: {
        sessionId,
        userId:      req.user.id,
        statut:      'present',
        methode:     'code',
        etudiantLat: latitude  || null,
        etudiantLng: longitude || null,
        distanceM,
        deviceId:    deviceId  || null, // ✅ stocker le device ID
      },
    });

    return res.status(201).json({
      message:   'Présence confirmée',
      confirmeA: presence.confirmeA,
      distanceM,
    });
  } catch (err) {
    console.error('[Presence] Confirmer:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════
// ÉTUDIANT — Historique personnel
// ══════════════════════════════════════════════════════════════════

app.get('/presence/historique/etudiant', auth, requireRole('etudiant'), async (req, res) => {
  try {
    const classeId =
      req.user.classeId ||
      (await prisma.user.findUnique({
        where:  { id: req.user.id },
        select: { classeEtudiantId: true },
      }))?.classeEtudiantId;

    if (!classeId)
      return res.json({ stats: { total: 0, presents: 0, absents: 0, taux: 0 }, historique: [] });

    const sessions = await prisma.sessionPresence.findMany({
      where:   { classeId, actif: false },
      include: { presences: { where: { userId: req.user.id } } },
      orderBy: { ouverteLe: 'desc' },
      take: 50,
    });

    const historique = sessions.map(s => ({
      sessionId:  s.id,
      matiere:    s.matiere,
      professeur: s.professeur,
      salle:      s.salle,
      type:       s.type,
      date:       s.ouverteLe,
      present:    s.presences.length > 0 && s.presences[0].statut === 'present',
      confirmeA:  s.presences[0]?.confirmeA || null,
    }));

    const nbPresents = historique.filter(h => h.present).length;

    return res.json({
      stats: {
        total:    historique.length,
        presents: nbPresents,
        absents:  historique.length - nbPresents,
        taux:     historique.length > 0
          ? Math.round((nbPresents / historique.length) * 100)
          : 0,
      },
      historique,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════
// ÉTUDIANT — Session active de sa classe
// ══════════════════════════════════════════════════════════════════

app.get('/presence/session-active', auth, requireRole('etudiant'), async (req, res) => {
  try {
    let classeIdFinal = req.headers['x-classe-id'] || null;

    if (!classeIdFinal) {
      const etudiant = await prisma.user.findUnique({
        where:  { id: req.user.id },
        select: { classeEtudiantId: true },
      });
      classeIdFinal = etudiant?.classeEtudiantId || null;
    }

    if (!classeIdFinal) return res.json({ session: null });

    const session = await prisma.sessionPresence.findFirst({
      where:   { classeId: classeIdFinal, actif: true },
      orderBy: { ouverteLe: 'desc' },
    });

    if (!session) return res.json({ session: null });

    const ttlRestant = await redis.ttl(`session:${session.code}`);
    if (ttlRestant <= 0) return res.json({ session: null });

    const dejaConfirme = await prisma.presence.findUnique({
      where: { sessionId_userId: { sessionId: session.id, userId: req.user.id } },
    });

    return res.json({
      session: {
        id:           session.id,
        code:         session.code,
        matiere:      session.matiere,
        professeur:   session.professeur,
        salle:        session.salle,
        type:         session.type,
        dureeMinutes: session.dureeMinutes,
        ttlRestant,
        dejaConfirme: !!dejaConfirme,
        geoRequise:   !!(session.gpsLat && session.gpsLng),
        rayonMetres:  session.rayonMetres,
      },
    });
  } catch (err) {
    console.error('[session-active]', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════
// HEALTH
// ══════════════════════════════════════════════════════════════════

app.get('/health', (_, res) =>
  res.json({ status: 'ok', service: 'presence-service' })
);

// ══════════════════════════════════════════════════════════════════
// DÉMARRAGE
// ══════════════════════════════════════════════════════════════════

const start = async () => {
  await prisma.$connect();
  console.log('[Presence Service] PostgreSQL connecté');
  redis.on('connect', () => console.log('[Presence Service] Redis connecté'));
  redis.on('error',   err => console.error('[Presence Service] Redis erreur:', err.message));
  app.listen(PORT, () => console.log(`[Presence Service] Port ${PORT} — OK`));
};

start().catch(err => { console.error(err); process.exit(1); });