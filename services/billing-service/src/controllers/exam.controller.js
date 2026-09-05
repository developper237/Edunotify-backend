// services/billing-service/src/controllers/exam.controller.js
const { prisma } = require('../utils/db');
const crypto = require('crypto');

const genererCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();
const MAX_AVISSEMENTS_CAMERA = 5;
const MAX_AVISSEMENTS_QUIT = 3;

// ──────────────────────────────────────────────────────────────────
// POST /exam/sessions — Créer une session d'examen (prof)
// Body: { titre, matiere, description?, dureeMinutes, sujets[] }
// ──────────────────────────────────────────────────────────────────

const creerSession = async (req, res) => {
  try {
    const { titre, matiere, description, dureeMinutes, sujets } = req.body;
    const profId = req.user.id;
    const etabId = req.user.etablissementId;
    const role = req.user.role;

    if (!['professeur', 'chef_departement', 'admin', 'super_admin'].includes(role)) {
      return res.status(403).json({ error: 'Seuls les professeurs peuvent créer des examens' });
    }
    if (!titre || !matiere || !dureeMinutes) {
      return res.status(400).json({ error: 'titre, matiere et dureeMinutes sont requis' });
    }

    const code = genererCode();

    const session = await prisma.sessionExamen.create({
      data: {
        codeInvitation: code,
        titre,
        matiere,
        description: description || null,
        dureeMinutes: parseInt(dureeMinutes),
        profId,
        etablissementId: etabId,
        sujets: {
          create: (sujets || []).map((s, i) => ({
            intitule: s.intitule || `Question ${i + 1}`,
            enonce: s.enonce || '',
            typeQuestion: s.type || 'qcm',
            options: s.options || null,
            points: s.points || 1,
            ordre: i,
          })),
        },
      },
      include: { sujets: true },
    });

    return res.status(201).json({ session });
  } catch (err) {
    console.error('[creerSession]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// POST /exam/sessions/:code/join — Rejoindre une session (étudiant)
// ──────────────────────────────────────────────────────────────────

const rejoindreSession = async (req, res) => {
  try {
    const { code } = req.params;
    const userId = req.user.id;

    const session = await prisma.sessionExamen.findUnique({
      where: { codeInvitation: code.toUpperCase() },
    });
    if (!session) return res.status(404).json({ error: 'Session introuvable' });
    if (session.statut === 'termine' || session.statut === 'annule') {
      // Vérifier si l'étudiant avait déjà participé
      const existantAvant = await prisma.participantExamen.findUnique({
        where: { sessionId_userId: { sessionId: session.id, userId } },
      });
      if (existantAvant) {
        return res.status(400).json({ error: 'Cette session est terminée', dejaTermine: true, participant: existantAvant, session });
      }
      return res.status(400).json({ error: 'Cette session est terminée' });
    }

    const existant = await prisma.participantExamen.findUnique({
      where: { sessionId_userId: { sessionId: session.id, userId } },
    });
    if (existant && existant.statut === 'invalide') {
      return res.status(403).json({ error: 'Vous avez été invalidé de cette session' });
    }
    if (existant && existant.statut === 'termine') {
      return res.status(400).json({ error: 'Vous avez déjà passé cet examen', dejaTermine: true, participant: existant, session });
    }
    if (existant) {
      return res.json({ participant: existant, session, dejaInscrit: true });
    }

    const participant = await prisma.participantExamen.create({
      data: { sessionId: session.id, userId },
    });

    return res.status(201).json({ participant, session });
  } catch (err) {
    console.error('[rejoindreSession]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// POST /exam/sessions/:id/start — Démarrer l'examen (prof)
// ──────────────────────────────────────────────────────────────────

const demarrerSession = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const session = await prisma.sessionExamen.findUnique({ where: { id } });
    if (!session) return res.status(404).json({ error: 'Session introuvable' });
    if (session.profId !== userId) return res.status(403).json({ error: 'Non autorisé' });

    const debut = new Date();
    const fin = new Date(debut.getTime() + session.dureeMinutes * 60 * 1000);

    const updated = await prisma.sessionExamen.update({
      where: { id },
      data: { debut, fin, statut: 'en_cours' },
    });

    return res.json({ session: updated });
  } catch (err) {
    console.error('[demarrerSession]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// GET /exam/sessions/:id — Infos de la session + sujets
// ──────────────────────────────────────────────────────────────────

const getSession = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const session = await prisma.sessionExamen.findUnique({
      where: { id },
      include: {
        sujets: { orderBy: { ordre: 'asc' } },
        participants: {
          where: { userId },
          include: { reponses: true },
        },
        prof: { select: { id: true, nom: true, prenom: true } },
      },
    });
    if (!session) return res.status(404).json({ error: 'Session introuvable' });

    // Sécurité : ne JAMAIS envoyer la clé 'correct' aux étudiants
    if (session.sujets) {
      session.sujets = session.sujets.map(s => {
        if (s.options && s.options.correct) {
          const { correct, ...safeOptions } = s.options;
          return { ...s, options: safeOptions };
        }
        return s;
      });
    }

    return res.json({ session });
  } catch (err) {
    console.error('[getSession]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// POST /exam/sessions/:id/answer — Soumettre une réponse
// Body: { sujetId, reponse }
// ──────────────────────────────────────────────────────────────────

const soumettreReponse = async (req, res) => {
  try {
    const { id } = req.params;
    const { sujetId, reponse } = req.body;
    const userId = req.user.id;

    const participant = await prisma.participantExamen.findUnique({
      where: { sessionId_userId: { sessionId: id, userId } },
    });
    if (!participant || participant.statut === 'invalide') {
      return res.status(403).json({ error: 'Non autorisé' });
    }

    const session = await prisma.sessionExamen.findUnique({ where: { id } });
    if (!session || session.statut !== 'en_cours') {
      return res.status(400).json({ error: 'Examen non actif' });
    }
    if (session.fin && new Date() > session.fin) {
      return res.status(400).json({ error: 'Temps écoulé' });
    }

    const sujet = await prisma.sujetExamen.findUnique({ where: { id: sujetId } });
    if (!sujet || sujet.sessionId !== id) {
      return res.status(404).json({ error: 'Sujet introuvable' });
    }

    const rep = await prisma.reponseExamen.upsert({
      where: { participantId_sujetId: { participantId: participant.id, sujetId } },
      update: { reponse, reponduLe: new Date() },
      create: { participantId: participant.id, sujetId, reponse },
    });

    return res.json({ reponse: rep });
  } catch (err) {
    console.error('[soumettreReponse]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// POST /exam/sessions/:id/warning — Signaler un avertissement
// Body: { type: 'camera' | 'quit' }
// ──────────────────────────────────────────────────────────────────

const signalerAvertissement = async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.body;
    const userId = req.user.id;

    const participant = await prisma.participantExamen.findUnique({
      where: { sessionId_userId: { sessionId: id, userId } },
    });
    if (!participant || participant.statut === 'termine' || participant.statut === 'invalide') {
      return res.status(400).json({ error: 'Participant non actif' });
    }

    const maxAvis = type === 'camera' ? MAX_AVISSEMENTS_CAMERA : MAX_AVISSEMENTS_QUIT;
    const nouveauTotal = participant.avertissements + 1;

    if (nouveauTotal >= maxAvis) {
      await prisma.participantExamen.update({
        where: { id: participant.id },
        data: { statut: 'invalide', deconnecteLe: new Date(), avertissements: nouveauTotal },
      });
      return res.json({
        invalide: true,
        message: type === 'camera'
          ? 'Session invalidée : trop de détournements de regard'
          : 'Session invalidée : tentatives de sortie multiples',
        avertissements: nouveauTotal,
      });
    }

    await prisma.participantExamen.update({
      where: { id: participant.id },
      data: { avertissements: nouveauTotal },
    });

    return res.json({
      invalide: false,
      avertissements: nouveauTotal,
      reste: maxAvis - nouveauTotal,
      message: `Avertissement ${nouveauTotal}/${maxAvis}`,
    });
  } catch (err) {
    console.error('[signalerAvertissement]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// POST /exam/sessions/:id/finish — Terminer l'examen (prof)
// ──────────────────────────────────────────────────────────────────

const terminerSession = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const session = await prisma.sessionExamen.findUnique({
      where: { id },
      include: { sujets: true, participants: { include: { reponses: true } } },
    });
    if (!session) return res.status(404).json({ error: 'Session introuvable' });
    if (session.profId !== userId) return res.status(403).json({ error: 'Non autorisé' });

    for (const participant of session.participants) {
      let score = 0;
      for (const sujet of session.sujets) {
        const reponse = participant.reponses.find(r => r.sujetId === sujet.id);
        if (reponse && sujet.typeQuestion === 'qcm') {
          const correct = sujet.options && reponse.reponse === sujet.options.correct;
          await prisma.reponseExamen.update({
            where: { id: reponse.id },
            data: { estCorrecte: correct, pointsObtenus: correct ? sujet.points : 0 },
          });
          if (correct) score += sujet.points;
        }
      }
      await prisma.participantExamen.update({
        where: { id: participant.id },
        data: { score, statut: participant.statut === 'invalide' ? 'invalide' : 'termine', deconnecteLe: new Date() },
      });
    }

    const updated = await prisma.sessionExamen.update({
      where: { id },
      data: { statut: 'termine', fin: new Date() },
    });

    return res.json({ session: updated });
  } catch (err) {
    console.error('[terminerSession]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// GET /exam/sessions/:id/results — Résultats (prof)
// ──────────────────────────────────────────────────────────────────

const getResultats = async (req, res) => {
  try {
    const { id } = req.params;

    const participants = await prisma.participantExamen.findMany({
      where: { sessionId: id },
      include: {
        user: { select: { id: true, nom: true, prenom: true, email: true } },
        reponses: { include: { sujet: true } },
      },
      orderBy: { score: 'desc' },
    });

    return res.json({ participants });
  } catch (err) {
    console.error('[getResultats]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// GET /exam/sessions/mes-sessions — Sessions du prof
// ──────────────────────────────────────────────────────────────────

const mesSessions = async (req, res) => {
  try {
    const profId = req.user.id;
    const sessions = await prisma.sessionExamen.findMany({
      where: { profId },
      include: {
        _count: { select: { participants: true, sujets: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ sessions });
  } catch (err) {
    console.error('[mesSessions]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// GET /exam/sessions/mes-resultats — Résultats étudiant
// Retourne les sessions auxquelles l'étudiant a participé avec sa note
// ──────────────────────────────────────────────────────────────────

const mesResultats = async (req, res) => {
  try {
    const userId = req.user.id;

    const participants = await prisma.participantExamen.findMany({
      where: {
        userId,
        statut: { in: ['termine', 'invalide'] },
      },
      include: {
        session: {
          include: {
            prof: { select: { id: true, nom: true, prenom: true } },
            _count: { select: { sujets: true } },
          },
        },
      },
      orderBy: { deconnecteLe: 'desc' },
    });

    const resultats = participants.map((p) => {
      const totalPoints = p.session.sujets.reduce((sum, s) => sum + s.points, 0);
      const noteSur20 = totalPoints > 0 && p.score != null
        ? parseFloat((p.score / totalPoints * 20).toFixed(1))
        : null;

      return {
        sessionId: p.session.id,
        titre: p.session.titre,
        matiere: p.session.matiere,
        statut: p.session.statut,
        codeInvitation: p.session.codeInvitation,
        debut: p.session.debut,
        fin: p.session.fin,
        dateCreation: p.session.createdAt,
        profNom: p.session.prof ? `${p.session.prof.prenom} ${p.session.prof.nom}` : '',
        nbSujets: p.session._count.sujets,
        score: p.score,
        totalPoints,
        noteSur20,
        statutParticipant: p.statut,
        avertissements: p.avertissements,
        termineLe: p.deconnecteLe,
      };
    });

    return res.json({ resultats });
  } catch (err) {
    console.error('[mesResultats]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// POST /exam/sessions/:id/submit — Étudiant termine son examen
// Corrige ses réponses, calcule le score, passe le statut à termine
// ──────────────────────────────────────────────────────────────────

const soumettreExamen = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const participant = await prisma.participantExamen.findUnique({
      where: { sessionId_userId: { sessionId: id, userId } },
    });
    if (!participant) {
      return res.status(404).json({ error: 'Vous n\'êtes pas inscrit à cette session' });
    }
    if (participant.statut === 'termine') {
      return res.status(400).json({ error: 'Vous avez déjà soumis cet examen' });
    }
    if (participant.statut === 'invalide') {
      return res.status(403).json({ error: 'Votre session a été invalidée' });
    }

    // Charger les sujets de la session
    const sujets = await prisma.sujetExamen.findMany({
      where: { sessionId: id },
      orderBy: { ordre: 'asc' },
    });

    // Charger les réponses du participant
    const reponses = await prisma.reponseExamen.findMany({
      where: { participantId: participant.id },
    });

    // Auto-correction
    let score = 0;
    const totalPoints = sujets.reduce((sum, s) => sum + s.points, 0);

    for (const sujet of sujets) {
      const rep = reponses.find(r => r.sujetId === sujet.id);
      if (!rep) continue;

      if (sujet.typeQuestion === 'qcm' && sujet.options) {
        const correct = rep.reponse === sujet.options.correct;
        await prisma.reponseExamen.update({
          where: { id: rep.id },
          data: { estCorrecte: correct, pointsObtenus: correct ? sujet.points : 0 },
        });
        if (correct) score += sujet.points;
      }
    }

    // Calculer la note sur 20
    const noteSur20 = totalPoints > 0
      ? parseFloat((score / totalPoints * 20).toFixed(1))
      : 0;

    // Mettre à jour le participant
    const updated = await prisma.participantExamen.update({
      where: { id: participant.id },
      data: {
        score,
        statut: 'termine',
        deconnecteLe: new Date(),
      },
    });

    return res.json({
      score,
      totalPoints,
      noteSur20,
      participant: updated,
    });
  } catch (err) {
    console.error('[soumettreExamen]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// GET /exam/sessions/:id/correction — Correction d'un examen
// Retourne les sujets avec la bonne réponse + la réponse de l'étudiant
// ──────────────────────────────────────────────────────────────────

const getCorrection = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Vérifier que l'étudiant a bien participé et terminé
    const participant = await prisma.participantExamen.findUnique({
      where: { sessionId_userId: { sessionId: id, userId } },
    });
    if (!participant) {
      return res.status(404).json({ error: 'Vous n\'avez pas participé à cette session' });
    }
    if (participant.statut !== 'termine' && participant.statut !== 'invalide') {
      return res.status(400).json({ error: 'Examen non terminé — la correction n\'est pas encore disponible' });
    }

    // Charger les sujets + réponses de l'étudiant
    const sujets = await prisma.sujetExamen.findMany({
      where: { sessionId: id },
      orderBy: { ordre: 'asc' },
    });

    const reponses = await prisma.reponseExamen.findMany({
      where: { participantId: participant.id },
    });

    const session = await prisma.sessionExamen.findUnique({
      where: { id },
      select: { titre: true, matiere: true, prof: { select: { nom: true, prenom: true } } },
    });

    const totalPoints = sujets.reduce((sum, s) => sum + s.points, 0);
    const noteSur20 = totalPoints > 0 && participant.score != null
      ? parseFloat((participant.score / totalPoints * 20).toFixed(1))
      : null;

    const correction = sujets.map((sujet) => {
      const rep = reponses.find(r => r.sujetId === sujet.id);
      const options = sujet.options || {};
      const correctKey = options.correct || null;
      const etudiantReponse = rep ? rep.reponse : null;
      const estCorrecte = rep ? rep.estCorrecte : null;

      return {
        id: sujet.id,
        intitule: sujet.intitule,
        enonce: sujet.enonce,
        typeQuestion: sujet.typeQuestion,
        options: sujet.options,
        points: sujet.points,
        ordre: sujet.ordre,
        correctKey,
        etudiantReponse,
        estCorrecte,
        pointsObtenus: rep ? rep.pointsObtenus : null,
      };
    });

    return res.json({
      session: {
        titre: session?.titre,
        matiere: session?.matiere,
        profNom: session?.prof ? `${session.prof.prenom} ${session.prof.nom}` : '',
      },
      correction,
      score: participant.score,
      totalPoints,
      noteSur20,
      statutParticipant: participant.statut,
    });
  } catch (err) {
    console.error('[getCorrection]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

module.exports = {
  creerSession,
  mesSessions,
  rejoindreSession,
  demarrerSession,
  getSession,
  soumettreReponse,
  signalerAvertissement,
  terminerSession,
  getResultats,
  mesResultats,
  soumettreExamen,
  getCorrection,
};
