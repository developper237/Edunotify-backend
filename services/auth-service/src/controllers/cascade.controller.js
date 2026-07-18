// services/auth-service/src/controllers/cascade.controller.js

const { validationResult } = require('express-validator');
const { prisma }           = require('../utils/db');
const {
  generateTempPassword,
  hashPassword,
  serializeUser,
} = require('../utils/helpers');
const EmailService = require('../../../../shared/email/emailService');

const sigles = {
  'Génie Logiciel': 'GL',
  'Administration et Sécurité des Réseaux': 'ASR',
  'Génie Informatique': 'GI',
  'Génie Réseau et Télécommunications': 'GRT',
  'Génie Électrique et Informatique Industrielle': 'GEII',
  'Génie Industriel et Maintenance': 'GIM',
  'Génie Mécanique et Productique': 'GMP',
  'Génie Thermique et Énergie': 'GTE',
  'Génie Biomédical': 'GBM',
  'Génie Civil': 'GC',
  'Génie des Mines': 'GMI',
  'Génie Métallurgique': 'GME',
  'Génie Ferroviaire': 'GFE',
  'Météorologie': 'MET',
  'Licence en Pétrole et Gaz': 'PG',
  'Logistique Industrielle': 'LI',
  'Économie d\'Énergie et Environnement': 'EEE',
  'Valorisation des Énergies Renouvelables': 'VER',
  'Chimie Pharmaceutique': 'CP',
  'Qualité, Hygiène et Salubrité des Aliments': 'QHSA',
  'Gestion des Entreprises et des Administrations': 'GEA',
  'Génie Logistique et Transport': 'GLT',
  'Techniques de Commercialisation': 'TC',
  'Organisation et Gestion Administrative': 'OGA',
  'Gestion Appliquée aux Petites et Moyennes Organisations': 'GAPMO',
  'Gestion Comptable et Financière': 'GCF',
  'Négociation Vente': 'CNV',
  'Gestion des Ressources Humaines': 'GRH',
  'Gestion Bancaire et Financière': 'GBF',
  'Banque et Finances': 'BAF',
  'Assistant Manager': 'AMA',
  'Chimie Industrielle et Pharmaceutique': 'CIP',
  'Mécatronique': 'MECA',
};

const normalize = (str) =>
  str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const siglesNormalises = Object.fromEntries(
  Object.entries(sigles).map(([nom, sigle]) => [normalize(nom), sigle])
);

const genererCodeClasse = (nomSalle, filiere, niveau, formation) => {
  const salle = nomSalle.trim().replace(/\s+/g, '');
  const sigle =
    siglesNormalises[normalize(filiere)] ||
    filiere.split(' ').map(w => w[0]?.toUpperCase() || '').join('');
  return `${salle}-${sigle}-${niveau}-${formation}`;
};

const CascadeController = {

  // ── ÉTABLISSEMENTS ──

  creerEtablissement: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { nom, ville, plan, emailAdmin, prenomAdmin, nomAdmin, logoUrl, gpsLat, gpsLng, gpsRayon } = req.body;

    try {
      const existingUser = await prisma.user.findUnique({ where: { email: emailAdmin } });
      if (existingUser) return res.status(409).json({ error: `L'email ${emailAdmin} est déjà utilisé` });

      const etablissement = await prisma.etablissement.create({
        data: {
          nom, ville, plan: plan || 'free', logoUrl,
          gpsLat:   gpsLat   ? parseFloat(gpsLat)   : null,
          gpsLng:   gpsLng   ? parseFloat(gpsLng)   : null,
          gpsRayon: gpsRayon ? parseInt(gpsRayon)   : 200,
        },
      });

      const tempPassword = generateTempPassword(emailAdmin.split('@')[0]);
      const passwordHash = await hashPassword(tempPassword);

      const admin = await prisma.user.create({
        data: {
          nom: nomAdmin, prenom: prenomAdmin, email: emailAdmin,
          passwordHash, role: 'admin', statut: 'premier_login',
          etablissementId: etablissement.id,
        },
      });

      await EmailService.sendAdminCredentials({
        prenom: prenomAdmin, nom: nomAdmin, email: emailAdmin,
        password: tempPassword, etablissementNom: nom,
      });

      return res.status(201).json({
        message: `Établissement créé. Identifiants envoyés à ${emailAdmin}`,
        etablissement,
        admin: { id: admin.id, email: admin.email, prenom: admin.prenom, nom: admin.nom },
      });
    } catch (err) {
      console.error('[CreerEtablissement]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  listerEtablissements: async (req, res) => {
    try {
      const etabs = await prisma.etablissement.findMany({
        include: { _count: { select: { users: true, departements: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return res.json({ etablissements: etabs });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  toggleStatutEtablissement: async (req, res) => {
    try {
      const etab = await prisma.etablissement.findUnique({ where: { id: req.params.id } });
      if (!etab) return res.status(404).json({ error: 'Établissement introuvable' });

      const updated = await prisma.etablissement.update({
        where: { id: req.params.id },
        data:  { actif: !etab.actif },
      });
      return res.json(updated);
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  changerPlanEtablissement: async (req, res) => {
    try {
      const etab = await prisma.etablissement.findUnique({ where: { id: req.params.id } });
      if (!etab) return res.status(404).json({ error: 'Établissement introuvable' });

      const nouveauPlan = etab.plan === 'premium' ? 'free' : 'premium';
      const updated = await prisma.etablissement.update({
        where: { id: req.params.id },
        data:  { plan: nouveauPlan },
      });
      return res.json(updated);
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── DÉPARTEMENTS ──

  creerDepartement: async (req, res) => {
    const { nom, description, emailChef, prenomChef, nomChef } = req.body;
    try {
      const admin = await prisma.user.findUnique({
         where: { id: req.user.id },
         include: { etablissement: true },
         });
      const existingUser = await prisma.user.findUnique({ where: { email: emailChef } });
      if (existingUser) return res.status(409).json({ error: `L'email ${emailChef} est déjà utilisé` });

      const departement = await prisma.departement.create({
        data: { nom, description, etablissementId: admin.etablissementId },
      });

      const tempPassword = generateTempPassword(emailChef.split('@')[0]);
      const passwordHash = await hashPassword(tempPassword);

      await prisma.user.create({
        data: {
          nom: nomChef, prenom: prenomChef, email: emailChef,
          passwordHash, role: 'chef_departement', statut: 'premier_login',
          etablissementId: admin.etablissementId, departementId: departement.id,
        },
      });
      await EmailService.sendChefCredentials({
  email:           emailChef,
  prenom:          prenomChef,
  nom:             nomChef,
  password:        tempPassword,
  departementNom:  nom,
  etablissementNom: admin.etablissementNom ?? '',
});

      return res.status(201).json({
  message:     'Département créé avec succès',
  departement: departement,
});
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  listerDepartements: async (req, res) => {
    try {
      const user  = await prisma.user.findUnique({ where: { id: req.user.id } });
      const where = req.user.role === 'super_admin' ? {} : { etablissementId: user.etablissementId };
      const depts = await prisma.departement.findMany({
        where,
        include: { _count: { select: { classes: true } }, chefs: { select: { id: true, nom: true, prenom: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return res.json({ departements: depts });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  modifierDepartement: async (req, res) => {
  try {
    const { nom, description, emailChef, prenomChef, nomChef } = req.body;

    // Mise à jour du département
    const updated = await prisma.departement.update({
      where: { id: req.params.id },
      data:  { nom, description },
    });

    // Si un nouveau chef est fourni, on crée son compte
    if (emailChef && prenomChef && nomChef) {
      // Vérifie que l'email n'est pas déjà utilisé
      const existing = await prisma.user.findUnique({ where: { email: emailChef } });
      if (existing) {
        return res.status(409).json({ error: `L'email ${emailChef} est déjà utilisé` });
      }

      const tempPassword = generateTempPassword(emailChef.split('@')[0]);
      const passwordHash = await hashPassword(tempPassword);

      // Récupère l'établissement pour l'email
      const dept = await prisma.departement.findUnique({
        where:   { id: req.params.id },
        include: { etablissement: true },
      });

      await prisma.user.create({
        data: {
          nom:             nomChef,
          prenom:          prenomChef,
          email:           emailChef,
          passwordHash,
          role:            'chef_departement',
          statut:          'premier_login',
          etablissementId: dept.etablissementId,
          departementId:   req.params.id,
        },
      });

      // Envoie les identifiants par email
      await EmailService.sendChefCredentials({
        email:            emailChef,
        prenom:           prenomChef,
        nom:              nomChef,
        password:         tempPassword,
        departementNom:   nom ?? dept.nom,
        etablissementNom: dept.etablissement?.nom ?? '',
      });
    }

    return res.json({ message: 'Département mis à jour', departement: updated });
  } catch (err) {
    console.error('[modifierDepartement]', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
},

  supprimerDepartement: async (req, res) => {
    try {
      await prisma.departement.delete({ where: { id: req.params.id } });
      return res.json({ message: 'Département supprimé' });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── CLASSES ──

  // Dans cascade.controller.js

  creerClasse: async (req, res) => {
  const { nomSalle, filiere, niveau, formation, emailDelegue, prenomDelegue, nomDelegue } = req.body;
  try {
    // 1. On récupère le chef AVEC son département (CORRECTION DU NOM DU CHAMP)
    const chef = await prisma.user.findUnique({ 
      where: { id: req.user.id },
      include: { 
        departementChef: true // <-- Correction ici
      } 
    });

    if (!chef || !chef.departementChef) { // <-- Correction ici
      return res.status(400).json({ error: "Chef de département introuvable ou non assigné." });
    }

    const codeGenere = genererCodeClasse(nomSalle, filiere, niveau, formation);
    
    // 2. Création de la classe
    const classe = await prisma.classe.create({
      data: { 
        nom: `${filiere} ${niveau}`, 
        filiere, 
        niveau, 
        formation, 
        codeGenere, 
        departementId: chef.departementId 
      },
    });

    // 3. Formatage du nom du délégué
    const sigleFiliere = siglesNormalises[normalize(filiere)] || filiere.substring(0, 3).toUpperCase();
    const nomAfficheDelegue = `Delegue ${nomSalle.trim()}-${sigleFiliere}-${niveau}`;

    const tempPassword = generateTempPassword(codeGenere.toLowerCase());
    const passwordHash = await hashPassword(tempPassword);

    // 4. Création du compte délégué
    await prisma.user.create({
      data: {
        nom: nomAfficheDelegue,
        prenom: prenomDelegue || '',
        email: emailDelegue,
        passwordHash,
        role: 'delegue',
        statut: 'premier_login',
        etablissementId: chef.etablissementId,
        departementId: chef.departementId,
        classeDelegueId: classe.id,
      },
    });

    // 5. ENVOI DU MAIL (CORRECTION ICI AUSSI)
    await EmailService.sendDelegueCredentials({
      prenom: prenomDelegue || 'Délégué',
      nom: nomAfficheDelegue,
      email: emailDelegue,
      password: tempPassword,
      classeCode: codeGenere,
      departementNom: chef.departementChef.nom // <-- Correction ici
    });

    return res.status(201).json(classe);
  } catch (err) {
    console.error('[CreerClasse Error]', err);
    return res.status(500).json({ error: err.message });
  }
},

  listerClasses: async (req, res) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      const where = req.user.role === 'chef_departement'
        ? { departementId: user.departementId }
        : { departement: { etablissementId: user.etablissementId } };
      const classes = await prisma.classe.findMany({
        where,
        include: { _count: { select: { etudiants: true } }, delegues: { select: { id: true, nom: true, prenom: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return res.json({ classes });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  modifierClasse: async (req, res) => {
    try {
      const updated = await prisma.classe.update({ where: { id: req.params.id }, data: req.body });
      return res.json(updated);
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  supprimerClasse: async (req, res) => {
    try {
      await prisma.classe.delete({ where: { id: req.params.id } });
      return res.json({ message: 'Classe supprimée' });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

    // DANS cascade.controller.js
maClasse: async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const classeId = user.classeDelegueId || user.classeEtudiantId;
    if (!classeId) return res.status(404).json({ error: 'Aucune classe associée' });
    
    const etudiants = await prisma.user.findMany({ 
      where: { classeEtudiantId: classeId, role: 'etudiant' } 
    });

    // CHANGE CETTE LIGNE : Enveloppe les résultats dans un objet
    return res.json({ etudiants: etudiants }); 
  } catch (err) {
    return res.status(500).json({ error: 'Erreur serveur' });
  }
},
  // ── UTILISATEURS ──

  listerUtilisateurs: async (req, res) => {
    try {
      const users = await prisma.user.findMany({ 
        where: { etablissementId: req.user.etablissementId },
        select: { id: true, nom: true, prenom: true, email: true, role: true, statut: true }
      });
      return res.json(users);
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  creerUtilisateur: async (req, res) => {
    return res.status(501).json({ message: "Fonctionnalité en cours de développement" });
  },

  modifierUtilisateur: async (req, res) => {
    try {
      const updated = await prisma.user.update({ where: { id: req.params.id }, data: req.body });
      return res.json(serializeUser(updated));
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  toggleStatutUtilisateur: async (req, res) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.params.id } });
      const updated = await prisma.user.update({ 
        where: { id: req.params.id }, 
        data: { actif: !user.actif } 
      });
      return res.json(updated);
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  supprimerUtilisateur: async (req, res) => {
    try {
      await prisma.user.delete({ where: { id: req.params.id } });
      return res.json({ message: 'Utilisateur supprimé' });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  resetPassword: async (req, res) => {
    try {
      const tempPassword = generateTempPassword('reset');
      const passwordHash = await hashPassword(tempPassword);
      await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash, statut: 'premier_login' } });
      return res.json({ message: 'Mot de passe réinitialisé', tempPassword });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  importCsv: async (req, res) => {
    return res.status(501).json({ message: "Import CSV non implémenté ici" });
  },

  // ── PLAN ──

  getPlanInfo: async (req, res) => {
    try {
      const etab = await prisma.etablissement.findUnique({
        where:  { id: req.user.etablissementId },
        select: {
          nom:  true,
          plan: true,
          _count: {
            select: {
              users:       true,
              departements: true,
            },
          },
        },
      });

      const classes = await prisma.classe.count({
        where: { departement: { etablissementId: req.user.etablissementId } },
      });

      const etudiants = await prisma.user.count({
        where: { etablissementId: req.user.etablissementId, role: 'etudiant' },
      });

      return res.json({
        plan:        etab.plan,
        nom:         etab.nom,
        stats: {
          departements: etab._count.departements,
          classes,
          etudiants,
        },
        limites: etab.plan === 'premium' ? null : {
          maxEtudiants:    50,
          maxClasses:      3,
          maxDepartements: 1,
          sondages:        false,
          chatbot:         false,
          exportPdf:       false,
        },
      });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },
};

module.exports = CascadeController;