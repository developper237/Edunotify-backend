const { GoogleGenerativeAI } = require('@google/generative-ai');
const { PrismaClient } = require('@prisma/client');

const genAI  = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const prisma = new PrismaClient();

// ══════════════════════════════════════════════════════════════════
// DÉCLARATIONS DES OUTILS GEMINI
// ══════════════════════════════════════════════════════════════════

const getStudentProfileDeclaration = {
  name: 'getStudentProfile',
  description:
    "Récupère les informations personnelles de l'étudiant connecté " +
    "(nom, prénom, classe, établissement). Ne demande aucun paramètre.",
  parameters: { type: 'OBJECT', properties: {} },
};

const getStudentNotesDeclaration = {
  name: 'getStudentNotes',
  description:
    "Récupère les notes réelles et la moyenne de l'étudiant connecté. " +
    "Cette fonction renvoie toutes les notes disponibles de l'étudiant.",
  parameters: { type: 'OBJECT', properties: {} },
};

const getStudentAbsencesDeclaration = {
  name: 'getStudentAbsences',
  description:
    "Récupère le nombre d'absences et le taux de présence de l'étudiant connecté. " +
    "Ne demande aucun paramètre.",
  parameters: { type: 'OBJECT', properties: {} },
};

// ══════════════════════════════════════════════════════════════════
// FONCTIONS RÉELLES — REQUÊTES PRISMA
// ══════════════════════════════════════════════════════════════════

async function getStudentProfile(studentId) {
  try {
    const user = await prisma.user.findUnique({
      where:   { id: studentId },
      include: {
        classeEtudiant: {
          select: { nom: true, codeGenere: true, filiere: true, niveau: true },
        },
        etablissement: { select: { nom: true } },
      },
    });
    if (!user) return { error: 'Profil introuvable.' };
    return {
      statut:        'Succès',
      nom:           user.nom,
      prenom:        user.prenom,
      email:         user.email,
      role:          user.role,
      classe:        user.classeEtudiant?.nom     ?? 'Non assignée',
      filiere:       user.classeEtudiant?.filiere ?? '',
      niveau:        user.classeEtudiant?.niveau  ?? '',
      etablissement: user.etablissement?.nom      ?? 'Non renseigné',
    };
  } catch (err) {
    console.error('[getStudentProfile]', err.message);
    return { error: 'Impossible de récupérer le profil.' };
  }
}

async function getStudentNotes(studentId) {
  try {
    const notes = await prisma.note.findMany({
      where: {
        etudiantId: studentId,
      },
      include: {
        matiere: { select: { nom: true, coefficient: true } },
      },
      orderBy: { matiere: { nom: 'asc' } },
    });

    if (notes.length === 0) {
      return {
        statut: 'Aucune note disponible pour le moment.',
        notes:     [],
        moyenneGenerale: null,
      };
    }

    let somme = 0;
    let totalCoeff = 0;

    const notesFormatees = notes.map((n) => {
      const coeff = n.matiere?.coefficient ?? 1;
      somme      += n.valeur * coeff;
      totalCoeff += coeff;
      return {
        matiere:     n.matiere?.nom ?? 'Inconnue',
        note:        n.valeur,
        coefficient: coeff,
      };
    });

    const moyenne = totalCoeff > 0
      ? Math.round((somme / totalCoeff) * 100) / 100
      : null;

    return {
      statut:          'Succès',
      notes:           notesFormatees,
      moyenneGenerale: moyenne,
    };
  } catch (err) {
    console.error('[getStudentNotes]', err.message);
    return { error: 'Impossible de récupérer les notes pour le moment.' };
  }
}

async function getStudentAbsences(studentId) {
  try {
    const presences = await prisma.presence.findMany({
      where:   { userId: studentId },
      include: {
        session: {
          select: {
            matiere:    true,
            professeur: true,
            type:       true,
            ouverteLe:  true,
          },
        },
      },
      orderBy: { session: { ouverteLe: 'desc' } },
    });

    const absences = presences.filter((p) => p.statut === 'absent');
    const presents = presences.filter((p) => p.statut === 'present');

    return {
      statut:        'Succès',
      totalSeances:  presences.length,
      totalPresents: presents.length,
      totalAbsences: absences.length,
      tauxPresence:  presences.length > 0
        ? `${Math.round((presents.length / presences.length) * 100)}%`
        : 'N/A',
      details: absences.map((a) => ({
        matiere:    a.session?.matiere    ?? 'Inconnue',
        professeur: a.session?.professeur ?? '',
        type:       a.session?.type       ?? '',
        date:       a.session?.ouverteLe  ?? null,
      })),
    };
  } catch (err) {
    console.error('[getStudentAbsences]', err.message);
    return { error: 'Impossible de récupérer les absences pour le moment.' };
  }
}

// ══════════════════════════════════════════════════════════════════
// PERSISTANCE — vérifie que ChatMessage existe avant d'écrire
// ══════════════════════════════════════════════════════════════════

let _chatMessageExists = null;

async function _hasChatMessage() {
  if (_chatMessageExists !== null) return _chatMessageExists;
  try {
    await prisma.chatMessage.count();
    _chatMessageExists = true;
  } catch (_) {
    _chatMessageExists = false;
    console.warn(
      '[Chatbot] Modèle ChatMessage absent ou inaccessible — ' +
      'persistance désactivée.'
    );
  }
  return _chatMessageExists;
}

async function _saveMessage(data) {
  if (!(await _hasChatMessage())) return;
  try {
    await prisma.chatMessage.create({ data });
  } catch (err) {
    console.warn('[Chatbot] Sauvegarde message échouée :', err.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// GET /api/chat/history
// ══════════════════════════════════════════════════════════════════

const getChatHistory = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId)
      return res.status(401).json({ error: 'Utilisateur non identifié.' });

    if (!(await _hasChatMessage()))
      return res.status(200).json([]);

    const messages = await prisma.chatMessage.findMany({
      where:   { userId },
      orderBy: { createdAt: 'asc' },
      take:    50,
    });

    return res.status(200).json(messages);
  } catch (err) {
    console.error('[getChatHistory]', err);
    return res.status(500).json({ error: "Impossible de charger l'historique." });
  }
};

// ══════════════════════════════════════════════════════════════════
// POST /api/chat — Contrôleur principal
// ══════════════════════════════════════════════════════════════════

const handleChatMessage = async (req, res) => {
  try {
    const { message, history } = req.body;
    const userId = req.headers['x-user-id'];

    if (!message)
      return res.status(400).json({ error: 'Le message est requis.' });
    if (!userId)
      return res.status(401).json({ error: 'Utilisateur non identifié.' });

    // Sauvegarder le message utilisateur (non-bloquant)
    await _saveMessage({ text: message, isUser: true, userId });

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      tools: [{
        functionDeclarations: [
          getStudentProfileDeclaration,
          getStudentNotesDeclaration,
          getStudentAbsencesDeclaration,
        ],
      }],
    });

    const systemInstruction =
      "Tu es SmartCampus Assistant, l'IA intégrée à l'application SmartCampus. " +
      "Tu aides l'étudiant connecté concernant son identité, ses notes, ses absences et son emploi du temps. " +
      "Réponds toujours en français de manière concise, claire et bienveillante. " +
      "Utilise des listes à puces pour les notes et les absences.\n\n" +
      "CONTEXTE DE SÉCURITÉ :\n" +
      `- L'identifiant unique de l'étudiant est : "${userId}".\n` +
      "- Ne demande JAMAIS son ID ou ses informations d'authentification.\n\n" +
      "RÈGLES D'EXÉCUTION DES FONCTIONS :\n" +
      "- Déclenche 'getStudentNotes' si l'étudiant demande ses notes, résultats ou moyennes.\n" +
      "- Déclenche 'getStudentAbsences' si l'étudiant demande ses absences ou présences.\n" +
      "- Déclenche 'getStudentProfile' si l'étudiant demande son nom, prénom ou profil.\n" +
      "- Si l'étudiant salue (ex: 'bonjour', 'salut'), NE DÉCLENCHE AUCUNE FONCTION. Réponds simplement.";

    const chat = model.startChat({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      history: Array.isArray(history) ? history : [],
    });

    let result = await chat.sendMessage(message);
    const functionCalls = result.response.functionCalls();

    if (functionCalls && functionCalls.length > 0) {
      const call = functionCalls[0];
      console.log(
        `[Gemini] Appel : ${call.name} | args: ${JSON.stringify(call.args)} | userId=${userId}`
      );

      let functionResult;

      if (call.name === 'getStudentProfile') {
        functionResult = await getStudentProfile(userId);
      } else if (call.name === 'getStudentNotes') {
        functionResult = await getStudentNotes(userId);
      } else if (call.name === 'getStudentAbsences') {
        functionResult = await getStudentAbsences(userId);
      }

      // Si la fonction a retourné une erreur interne Prisma
      if (functionResult?.error) {
        const errorReply = functionResult.error;
        await _saveMessage({ text: errorReply, isUser: false, userId });
        return res.status(200).json({ reply: errorReply });
      }

      // Envoi du résultat de la fonction mis au propre pour le SDK Gemini
      result = await chat.sendMessage([
        {
          functionResponse: {
            name: call.name,
            response: { result: functionResult }
          }
        }
      ]);
    }

    const responseText = result.response.text();

    // Sauvegarder la réponse IA (non-bloquant)
    await _saveMessage({ text: responseText, isUser: false, userId });

    return res.status(200).json({ reply: responseText });

  } catch (err) {
    console.error('[Chatbot - CRASH FINAL]:', err);
    return res.status(200).json({
      reply: "Désolé, mon module de réflexion rencontre des difficultés. Réessaie dans un instant !",
    });
  }
};

module.exports = { handleChatMessage, getChatHistory };