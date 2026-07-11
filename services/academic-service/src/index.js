const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const morgan     = require('morgan');
const multer     = require('multer');
const XLSX       = require('xlsx');
const nodemailer = require('nodemailer');
const { PrismaClient } = require('../../../node_modules/.prisma/client');

const app    = express();
const PORT   = process.env.PORT || 3005;
const prisma = new PrismaClient();

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
});

// ══════════════════════════════════════════════════════════════════
// MIDDLEWARES
// ══════════════════════════════════════════════════════════════════

const auth = (req, res, next) => {
  req.user = {
    id:            req.headers['x-user-id'],
    role:          req.headers['x-user-role'],
    departementId: req.headers['x-dept-id']   || null,
    classeId:      req.headers['x-classe-id'] || null,
  };
  if (!req.user.id) return res.status(401).json({ error: 'Non authentifié' });
  next();
};

const requireRole = (...roles) => (req, res, next) => {
  // Permet de gérer à la fois requireRole('admin') et requireRole(['role1', 'role2'])
  const flattenedRoles = roles.flat();
  if (!flattenedRoles.includes(req.user.role))
    return res.status(403).json({ error: 'Accès refusé' });
  next();
};

// ══════════════════════════════════════════════════════════════════
// UTILITAIRES
// ══════════════════════════════════════════════════════════════════

function getMention(note) {
  if (note >= 16) return 'Très bien';
  if (note >= 14) return 'Bien';
  if (note >= 12) return 'Assez bien';
  if (note >= 10) return 'Passable';
  return 'Insuffisant';
}

async function envoyerEmailRequete(email, prenom, matiere, reponse, statut) {
  try {
    const label = statut === 'traitee' ? 'Traitée ✅' : 'Rejetée ❌';
    await mailer.sendMail({
      from:    `"EduNotify" <${process.env.GMAIL_USER}>`,
      to:      email,
      subject: `Requête note — ${matiere} : ${label}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
          <h2 style="color:#0ea5e9">EduNotify — Réponse à votre requête</h2>
          <p>Bonjour <strong>${prenom}</strong>,</p>
          <p>Votre requête concernant <strong>${matiere}</strong> a été <strong>${label}</strong>.</p>
          <div style="background:#f1f5f9;border-radius:8px;padding:16px;margin:16px 0">
            <strong>Réponse :</strong>
            <p style="margin-top:8px">${reponse}</p>
          </div>
        </div>`,
    });
  } catch (err) {
    console.error('[Academic] Email:', err.message);
  }
}

const COLONNES_FIXES = ['matricule','nom','prenom','Matricule','Nom','Prenom','MATRICULE','NOM','PRENOM'];

function getMatricule(row) {
  return (row['Matricule'] || row['matricule'] || row['MATRICULE'] || '').toString().trim();
}

// ══════════════════════════════════════════════════════════════════
// CHEF — Import Excel (preview)
// ══════════════════════════════════════════════════════════════════

app.post('/academic/import/preview',
  auth, requireRole('chef_departement', 'admin'), upload.single('fichier'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Fichier requis' });
    try {
      const wb    = XLSX.read(req.file.buffer, { type: 'buffer' });
      const rows  = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
      if (!rows.length) return res.status(400).json({ error: 'Fichier vide' });

      const matieres = Object.keys(rows[0]).filter(c => !COLONNES_FIXES.includes(c));
      const apercu   = rows.slice(0, 5).map(row => {
        const notes = {};
        for (const m of matieres) notes[m] = row[m];
        return { matricule: getMatricule(row), notes };
      });

      return res.json({ totalLignes: rows.length, matieresTrouvees: matieres, apercu });
    } catch (err) {
      return res.status(400).json({ error: 'Format de fichier invalide' });
    }
  }
);

// ══════════════════════════════════════════════════════════════════
// CHEF — Import + création d'une publication
// ══════════════════════════════════════════════════════════════════

app.post('/academic/import',
  auth, requireRole('chef_departement', 'admin'), upload.single('fichier'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Fichier requis' });

    const { classeId, titre, semestre, publier } = req.body;
    if (!classeId) return res.status(400).json({ error: 'classeId requis' });
    if (!titre)    return res.status(400).json({ error: 'Le titre de la publication est requis' });

    const doitPublier = publier === 'true' || publier === true;

    try {
      const wb   = XLSX.read(req.file.buffer, { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
      if (!rows.length) return res.status(400).json({ error: 'Fichier vide' });

      const chef          = await prisma.user.findUnique({ where: { id: req.user.id } });
      const colonnesMat   = Object.keys(rows[0]).filter(c => !COLONNES_FIXES.includes(c));
      const resultats     = { importees: 0, erreurs: [] };

      const publication = await prisma.publicationNotes.create({
        data: {
          titre,
          semestre:  semestre || 'Semestre 1',
          classeId,
          publiePar: req.user.id,
        },
      });

      for (const nomMatiere of colonnesMat) {
        let matiere = await prisma.matiere.findFirst({
          where: { nom: nomMatiere, classeId },
        });

        if (!matiere) {
          matiere = await prisma.matiere.create({
            data: { nom: nomMatiere, classeId, coefficient: 1, departementId: chef?.departementId ?? null },
          });
        } else if (!matiere.departementId && chef?.departementId) {
          await prisma.matiere.update({
            where: { id: matiere.id },
            data:  { departementId: chef.departementId },
          });
        }

        for (const row of rows) {
          const matricule = getMatricule(row);
          const valeurRaw = row[nomMatiere];
          if (!matricule || valeurRaw == null) continue;

          const valeur = parseFloat(valeurRaw);
          if (isNaN(valeur) || valeur < 0 || valeur > 20) {
            resultats.erreurs.push({ matricule, matiere: nomMatiere, erreur: `Note invalide : ${valeurRaw}` });
            continue;
          }

          const etudiant = await prisma.user.findFirst({
            where: { matricule, classeEtudiantId: classeId },
          });

          if (!etudiant) {
            resultats.erreurs.push({ matricule, matiere: nomMatiere, erreur: 'Étudiant introuvable' });
            continue;
          }

          await prisma.note.create({
            data: {
              matiereId:     matiere.id,
              etudiantId:    etudiant.id,
              valeur,
              publiee:       doitPublier,
              saisieParId:   req.user.id,
              publicationId: publication.id,
            },
          });

          resultats.importees++;
        }
      }

      return res.json({
        message:       `Import terminé — ${resultats.importees} note(s) sauvegardée(s)`,
        publicationId: publication.id,
        titre,
        publiees:      doitPublier,
        resultats,
      });
    } catch (err) {
      console.error('[Academic] Import:', err);
      return res.status(500).json({ error: 'Erreur serveur : ' + err.message });
    }
  }
);

// ══════════════════════════════════════════════════════════════════
// CHEF — Publier une publication existante
// ══════════════════════════════════════════════════════════════════

app.post('/academic/publications/:id/publier',
  auth, requireRole('chef_departement', 'admin'),
  async (req, res) => {
    try {
      const pub = await prisma.publicationNotes.findUnique({
        where: { id: req.params.id },
      });
      if (!pub) return res.status(404).json({ error: 'Publication introuvable' });

      const chef = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (chef?.departementId) {
        await prisma.matiere.updateMany({
          where: { classeId: pub.classeId, departementId: null },
          data:  { departementId: chef.departementId },
        });
      }

      const result = await prisma.note.updateMany({
        where: { publicationId: req.params.id, publiee: false },
        data:  { publiee: true },
      });

      return res.json({
        message:  `${result.count} note(s) publiée(s)`,
        count:    result.count,
        publieLe: new Date().toISOString(),
      });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);
// ══════════════════════════════════════════════════════════════════
// CHEF — Supprimer une publication
// ══════════════════════════════════════════════════════════════════

app.delete('/academic/publications/:id',
  auth, requireRole('chef_departement', 'admin'),
  async (req, res) => {
    try {
      const pub = await prisma.publicationNotes.findUnique({
        where: { id: req.params.id },
      });
      if (!pub) return res.status(404).json({ error: 'Publication introuvable' });

      // Supprimer d'abord les notes liées (cascade manuelle si pas définie)
      await prisma.note.deleteMany({
        where: { publicationId: req.params.id },
      });

      await prisma.publicationNotes.delete({
        where: { id: req.params.id },
      });

      return res.json({ message: 'Publication supprimée avec succès' });
    } catch (err) {
      console.error('[Academic] Supprimer publication:', err);
      return res.status(500).json({ error: 'Erreur serveur : ' + err.message });
    }
  }
);

// ══════════════════════════════════════════════════════════════════
// CHEF — Liste des publications d'une classe (historique)
// ══════════════════════════════════════════════════════════════════

app.get('/academic/classes/:classeId/publications',
  auth, requireRole('chef_departement', 'admin'),
  async (req, res) => {
    try {
      const publications = await prisma.publicationNotes.findMany({
        where:   { classeId: req.params.classeId },
        include: {
          _count:  { select: { notes: true } },
          auteur:  { select: { nom: true, prenom: true } },
        },
        orderBy: { publieLe: 'desc' },
      });

      return res.json({
        publications: publications.map(p => ({
          id:        p.id,
          titre:     p.titre,
          semestre:  p.semestre,
          publieLe:  p.publieLe,
          nbNotes:   p._count.notes,
          publiePar: `${p.auteur.prenom} ${p.auteur.nom}`,
          publiee:   true,
        })),
      });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ══════════════════════════════════════════════════════════════════
// CHEF — Lister les requêtes de son département
// ══════════════════════════════════════════════════════════════════

app.get('/academic/requetes',
  auth, requireRole('chef_departement'),
  async (req, res) => {
    try {
      const chef     = await prisma.user.findUnique({ where: { id: req.user.id } });
      const classes  = await prisma.classe.findMany({
        where:  { departementId: chef.departementId },
        select: { id: true },
      });
      const classeIds = classes.map(c => c.id);

      const requetes = await prisma.requeteNote.findMany({
        where: {
          OR: [
            { matiere: { departementId: chef.departementId } },
            { matiere: { classeId: { in: classeIds } } },
          ],
        },
        include: {
          etudiant: { select: { id: true, nom: true, prenom: true, matricule: true, email: true } },
          matiere:  { select: { id: true, nom: true } },
          note:     { select: { id: true, valeur: true, publicationId: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.json({
        requetes: requetes.map(r => ({
          id:           r.id,
          statut:       r.statut,
          motif:        r.motif,
          reponse:      r.reponse,
          createdAt:    r.createdAt,
          updatedAt:    r.updatedAt,
          etudiant:     r.etudiant,
          matiere:      r.matiere.nom,
          noteActuelle: r.note.valeur,
        })),
      });
    } catch (err) {
      console.error('[Academic] Requêtes chef:', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ══════════════════════════════════════════════════════════════════
// CHEF — Traiter une requête
// ══════════════════════════════════════════════════════════════════

app.patch('/academic/requetes/:id',
  auth, requireRole('chef_departement'),
  async (req, res) => {
    const { statut, reponse, nouvelleNote } = req.body;
    if (!statut || !['traitee','rejetee'].includes(statut))
      return res.status(400).json({ error: 'Statut invalide' });
    if (!reponse)
      return res.status(400).json({ error: 'Réponse obligatoire' });

    try {
      const requete = await prisma.requeteNote.findUnique({
        where:   { id: req.params.id },
        include: { etudiant: true, matiere: true, note: true },
      });

      if (!requete)     return res.status(404).json({ error: 'Requête introuvable' });
      if (requete.statut !== 'en_attente')
        return res.status(409).json({ error: 'Requête déjà traitée' });

      await prisma.requeteNote.update({
        where: { id: req.params.id },
        data:  { statut, reponse, traiteeParId: req.user.id },
      });

      if (statut === 'traitee' && nouvelleNote !== undefined) {
        const v = parseFloat(nouvelleNote);
        if (!isNaN(v) && v >= 0 && v <= 20) {
          await prisma.note.update({ where: { id: requete.noteId }, data: { valeur: v } });
        }
      }

      await envoyerEmailRequete(
        requete.etudiant.email, requete.etudiant.prenom,
        requete.matiere.nom, reponse, statut,
      );

      return res.json({ message: 'Requête traitée avec succès' });
    } catch (err) {
      console.error('[Academic] Traiter requête:', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ══════════════════════════════════════════════════════════════════
// ÉTUDIANT & DÉLÉGUÉ — Liste des publications de sa classe
// ══════════════════════════════════════════════════════════════════

app.get('/academic/mes-publications',
  auth, requireRole(['etudiant', 'delegue']), // 💡 AJOUTÉ : 'delegue'
  async (req, res) => {
    try {
      const etudiant = await prisma.user.findUnique({
        where:   { id: req.user.id },
        include: { classeEtudiant: true },
      });

      if (!etudiant?.classeEtudiantId)
        return res.json({ publications: [] });

      const publications = await prisma.publicationNotes.findMany({
        where: {
          classeId: etudiant.classeEtudiantId,
          notes: {
            some: { etudiantId: req.user.id, publiee: true },
          },
        },
        include: {
          _count: {
            select: {
              notes: { where: { etudiantId: req.user.id, publiee: true } },
            },
          },
        },
        orderBy: { publieLe: 'desc' },
      });

      const result = await Promise.all(publications.map(async p => {
        const notes = await prisma.note.findMany({
          where:   { publicationId: p.id, etudiantId: req.user.id, publiee: true },
          include: { matiere: { select: { coefficient: true } } },
        });

        const totalCoeff  = notes.reduce((s, n) => s + n.matiere.coefficient, 0);
        const totalPoints = notes.reduce((s, n) => s + n.valeur * n.matiere.coefficient, 0);
        const moyenne     = totalCoeff > 0 ? parseFloat((totalPoints / totalCoeff).toFixed(2)) : null;

        return {
          id:       p.id,
          titre:    p.titre,
          semestre: p.semestre,
          publieLe: p.publieLe,
          nbNotes:  notes.length,
          moyenne,
          admis:    moyenne !== null ? moyenne >= 10 : null,
        };
      }));

      return res.json({ publications: result });
    } catch (err) {
      console.error('[Academic] Mes publications:', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ══════════════════════════════════════════════════════════════════
// ÉTUDIANT & DÉLÉGUÉ — Détail d'une publication (ses notes)
// ══════════════════════════════════════════════════════════════════

app.get('/academic/publications/:id/bulletin',
  auth, requireRole(['etudiant', 'delegue']), // 💡 AJOUTÉ : 'delegue'
  async (req, res) => {
    try {
      const publication = await prisma.publicationNotes.findUnique({
        where: { id: req.params.id },
        include: { classe: true },
      });
      if (!publication)
        return res.status(404).json({ error: 'Publication introuvable' });

      const etudiant = await prisma.user.findUnique({
        where:   { id: req.user.id },
        include: { classeEtudiant: true },
      });

      const matieres = await prisma.matiere.findMany({
        where:   { classeId: publication.classeId },
        orderBy: { nom: 'asc' },
      });

      const notes = await prisma.note.findMany({
        where:   {
          publicationId: req.params.id,
          etudiantId:    req.user.id,
          publiee:       true,
        },
        include: { matiere: true },
      });

      const noteMap = {};
      for (const n of notes) noteMap[n.matiereId] = n;

      const lignes = matieres.map(m => {
        const note = noteMap[m.id];
        return {
          id:          note?.id          ?? `missing-${m.id}`,
          matiereId:   m.id,
          matiere:     m.nom,
          coefficient: m.coefficient,
          valeur:      note?.valeur      ?? null,
          mention:     note ? getMention(note.valeur) : 'À rattraper',
          manquante:   !note,
        };
      });

      const lignesNotees = lignes.filter(l => l.valeur !== null);
      const totalCoeff   = lignesNotees.reduce((s, n) => s + n.coefficient, 0);
      const totalPoints  = lignesNotees.reduce(
        (s, n) => s + (n.valeur ?? 0) * n.coefficient, 0
      );
      const moyenne = totalCoeff > 0
        ? parseFloat((totalPoints / totalCoeff).toFixed(2))
        : null;

      return res.json({
        publication: {
          id:       publication.id,
          titre:    publication.titre,
          semestre: publication.semestre,
          publieLe: publication.publieLe,
        },
        etudiant: {
          nom:       etudiant.nom,
          prenom:    etudiant.prenom,
          matricule: etudiant.matricule,
          classe:    etudiant.classeEtudiant?.codeGenere,
        },
        notes:   lignes,
        moyenne,
        mention: moyenne !== null ? getMention(moyenne) : null,
        admis:   moyenne !== null ? moyenne >= 10 : false,
      });
    } catch (err) {
      console.error('[Academic] Bulletin:', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ══════════════════════════════════════════════════════════════════
// ÉTUDIANT & DÉLÉGUÉ — Badge : nouvelles publications depuis une date
// ══════════════════════════════════════════════════════════════════

app.get('/academic/badge',
  auth, requireRole(['etudiant', 'delegue']), // 💡 AJOUTÉ : 'delegue'
  async (req, res) => {
    try {
      const etudiant = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!etudiant?.classeEtudiantId) return res.json({ count: 0 });

      const depuis = req.query.depuis ? new Date(req.query.depuis) : null;

      const count = await prisma.publicationNotes.count({
        where: {
          classeId: etudiant.classeEtudiantId,
          notes:    { some: { etudiantId: req.user.id, publiee: true } },
          ...(depuis ? { publieLe: { gt: depuis } } : {}),
        },
      });

      return res.json({ count });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ══════════════════════════════════════════════════════════════════
// ÉTUDIANT & DÉLÉGUÉ — Soumettre une requête
// ══════════════════════════════════════════════════════════════════

app.post('/academic/requetes',
  auth, requireRole(['etudiant', 'delegue']), // 💡 AJOUTÉ : 'delegue'
  async (req, res) => {
    const { noteId, motif } = req.body;
    if (!noteId || !motif)
      return res.status(400).json({ error: 'noteId et motif requis' });
    if (motif.trim().length < 10)
      return res.status(400).json({ error: 'Motif trop court (min 10 caractères)' });

    try {
      const note = await prisma.note.findUnique({
        where: { id: noteId }, include: { matiere: true },
      });

      if (!note)                    return res.status(404).json({ error: 'Note introuvable' });
      if (note.etudiantId !== req.user.id) return res.status(403).json({ error: 'Note inaccessible' });
      if (!note.publiee)                return res.status(400).json({ error: 'Note non publiée' });

      const existante = await prisma.requeteNote.findFirst({
        where: { noteId, etudiantId: req.user.id, statut: 'en_attente' },
      });
      if (existante) return res.status(409).json({ error: 'Requête déjà en attente pour cette note' });

      const requete = await prisma.requeteNote.create({
        data: { noteId, matiereId: note.matiereId, etudiantId: req.user.id, motif: motif.trim() },
      });

      return res.status(201).json({
        message: 'Requête soumise',
        requete: {
          id: requete.id, statut: requete.statut,
          motif: requete.motif, matiere: note.matiere.nom, createdAt: requete.createdAt,
        },
      });
    } catch (err) {
      console.error('[Academic] Requête:', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ══════════════════════════════════════════════════════════════════
// ÉTUDIANT & DÉLÉGUÉ — Ses requêtes
// ══════════════════════════════════════════════════════════════════

app.get('/academic/requetes/mes-requetes',
  auth, requireRole(['etudiant', 'delegue']), // 💡 AJOUTÉ : 'delegue'
  async (req, res) => {
    try {
      const requetes = await prisma.requeteNote.findMany({
        where:   { etudiantId: req.user.id },
        include: { matiere: { select: { nom: true } }, note: { select: { valeur: true } } },
        orderBy: { createdAt: 'desc' },
      });

      return res.json({
        requetes: requetes.map(r => ({
          id: r.id, statut: r.statut, motif: r.motif, reponse: r.reponse,
          matiere: r.matiere.nom, noteActuelle: r.note.valeur,
          createdAt: r.createdAt, updatedAt: r.updatedAt,
        })),
      });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ══════════════════════════════════════════════════════════════════
// COMMUN — Classes groupées par filière (chef, admin & délégué)
// ══════════════════════════════════════════════════════════════════

app.get('/academic/mes-classes',
  auth, requireRole(['chef_departement', 'admin', 'delegue']), // 💡 AJOUTÉ : 'delegue' pour qu'il puisse voir sa structure de classe
  async (req, res) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      
      // Si c'est un délégué, on prend le département rattaché à sa classe d'étude
      let departementId = user?.departementId;
      if (!departementId && req.user.role === 'delegue') {
        const classeDelegue = await prisma.classe.findUnique({
          where: { id: user?.classeEtudiantId }
        });
        departementId = classeDelegue?.departementId;
      }

      if (!departementId)
        return res.status(400).json({ error: 'Département non trouvé ou non rattaché' });

      const classes = await prisma.classe.findMany({
        where:   { departementId: departementId },
        include: { _count: { select: { etudiants: true, matieres: true } } },
        orderBy: [{ filiere: 'asc' }, { niveau: 'asc' }],
      });

      const grouped = {};
      for (const c of classes) {
        if (!grouped[c.filiere]) grouped[c.filiere] = [];
        grouped[c.filiere].push({
          id: c.id, nom: c.nom, filiere: c.filiere,
          niveau: c.niveau, formation: c.formation, codeGenere: c.codeGenere,
          nbEtudiants: c._count.etudiants, nbMatieres: c._count.matieres,
        });
      }

      return res.json({ filieres: grouped });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ══════════════════════════════════════════════════════════════════
// HEALTH
// ══════════════════════════════════════════════════════════════════

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'academic-service' }));

const start = async () => {
  await prisma.$connect();
  app.listen(PORT, () => console.log(`[Academic Service] Port ${PORT} — OK`));
};

start().catch(err => { console.error(err); process.exit(1); });