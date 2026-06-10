// services/auth-service/src/controllers/csv.controller.js

const { parse }    = require('csv-parse/sync');
const { prisma }   = require('../utils/db');
const {
  generateTempPassword,
  hashPassword,
} = require('../utils/helpers');
const EmailService = require('../../../../shared/email/emailService');

const CsvController = {

  // ── POST /auth/csv/import ───────────────────────────────────────
  importerEtudiants: async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier CSV fourni' });
    }

    try {
      // Récupérer le délégué et sa classe
      const delegue = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: {
          classeDelegue: true,
          etablissement: true,
        },
      });

      if (!delegue?.classeDelegueId) {
        return res.status(400).json({
          error: 'Délégué sans classe associée',
        });
      }

      // Parser le CSV
      const content = req.file.buffer.toString('utf-8');
      let rows;
      try {
        rows = parse(content, {
          columns:          true,
          skip_empty_lines: true,
          trim:             true,
          bom:              true,
        });
      } catch (parseErr) {
        return res.status(400).json({
          error: 'Fichier CSV invalide : ' + parseErr.message,
        });
      }

      if (rows.length === 0) {
        return res.status(400).json({ error: 'Le fichier CSV est vide' });
      }

      // Résultats
      const results = {
        created:  [],
        skipped:  [],
        errors:   [],
      };

      const emailsAEnvoyer = [];

      // Traitement ligne par ligne
      for (const row of rows) {
        const matricule = (row.matricule || row.Matricule || '').trim();
        const nom       = (row.nom       || row.Nom       || '').trim().toUpperCase();
        const prenom    = (row.prenom    || row.Prenom    || '').trim();
        const email     = (row.email     || row.Email     || '').trim().toLowerCase();
        const niveau    = (row.niveau    || row.Niveau    || 'L1').trim();
        const formation = (row.formation || row.Formation || 'FI').trim();

        // Validation
        if (!matricule) {
          results.errors.push({ row: JSON.stringify(row), error: 'Matricule manquant' });
          continue;
        }
        if (!email || !email.includes('@')) {
          results.errors.push({ matricule, error: 'Email invalide' });
          continue;
        }
        if (!nom || !prenom) {
          results.errors.push({ matricule, error: 'Nom ou prénom manquant' });
          continue;
        }

        // Vérifier si le compte existe déjà
        const existing = await prisma.user.findFirst({
          where: {
            OR: [
              { email },
              { matricule },
            ],
          },
        });

        if (existing) {
          results.skipped.push({
            matricule,
            email,
            reason: existing.email === email
              ? 'Email déjà utilisé'
              : 'Matricule déjà utilisé',
          });
          continue;
        }

        // Générer mot de passe
        const tempPassword = generateTempPassword(matricule);
        const passwordHash = await hashPassword(tempPassword);

        // Créer le compte
        try {
          const etudiant = await prisma.user.create({
            data: {
              nom,
              prenom,
              email,
              passwordHash,
              matricule,
              role:               'etudiant',
              statut:             'premier_login',
              etablissementId:    delegue.etablissementId,
              departementId:      delegue.departementId,
              classeEtudiantId:   delegue.classeDelegueId,
            },
          });

          results.created.push({
            id:        etudiant.id,
            matricule,
            email,
            nom,
            prenom,
          });

          emailsAEnvoyer.push({
            prenom,
            nom,
            email,
            password:   tempPassword,
            matricule,
            classeCode: delegue.classeDelegue.codeGenere,
          });
        } catch (createErr) {
          results.errors.push({ matricule, error: createErr.message });
        }
      }

      // Envoyer les emails en masse (non bloquant)
      if (emailsAEnvoyer.length > 0) {
        EmailService.sendBulkEtudiantCredentials(emailsAEnvoyer)
          .then(emailResults => {
            console.log(`[CSV Import] Emails: ${emailResults.success} envoyés, ${emailResults.failed} échoués`);
          })
          .catch(err => console.error('[CSV Import] Erreur envoi emails:', err));
      }

      return res.status(201).json({
        message: `Import terminé : ${results.created.length} créé(s), ${results.skipped.length} ignoré(s), ${results.errors.length} erreur(s)`,
        summary: {
          total:   rows.length,
          created: results.created.length,
          skipped: results.skipped.length,
          errors:  results.errors.length,
        },
        details: results,
      });
    } catch (err) {
      console.error('[CSV Import]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── GET /auth/csv/template ──────────────────────────────────────
  getTemplate: (req, res) => {
    const csv = [
      'matricule,nom,prenom,email,niveau,formation',
      '21G0001,DUPONT,Jean,jean.dupont@iut.cm,L1,FI',
      '21G0002,NGONO,Marie,marie.ngono@iut.cm,L1,FI',
      '21G0003,BIYA,Paul,paul.biya@iut.cm,L1,FA',
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="edunotify_template.csv"'
    );
    return res.send(csv);
  },

  // ── GET /auth/csv/classe/:classeId ──────────────────────────────
  getEtudiantsClasse: async (req, res) => {
    const { classeId } = req.params;

    try {
      const etudiants = await prisma.user.findMany({
        where: {
          classeEtudiantId: classeId,
          role: 'etudiant',
        },
        select: {
          id:        true,
          nom:       true,
          prenom:    true,
          email:     true,
          matricule: true,
          statut:    true,
        },
        orderBy: { nom: 'asc' },
      });

      return res.json({
        total:    etudiants.length,
        etudiants,
      });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },
};

module.exports = CsvController;
