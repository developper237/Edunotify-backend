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
'Gestion des Entreprises et des Administrations':'GEA',
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

// Normalise une chaîne pour comparaison : enlève les accents, passe en
// minuscules, trim. Permet de faire matcher "Genie Logiciel" (sans accent,
// tel qu'envoyé par le mobile) avec "Génie Logiciel" (clé accentuée du
// dictionnaire ci-dessus) sans avoir à dupliquer chaque entrée.
const normalize = (str) =>
  str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

// Dictionnaire des sigles indexé par clé normalisée (sans accents, minuscules)
const siglesNormalises = Object.fromEntries(
  Object.entries(sigles).map(([nom, sigle]) => [normalize(nom), sigle])
);

// IMPORTANT : l'ordre des paramètres ci-dessous (nomSalle, filiere, niveau,
// formation) doit correspondre exactement à l'ordre utilisé lors de l'appel
// dans creerClasse: genererCodeClasse(nomSalle, filiere, niveau, formation).
// Avant, la signature était (filiere, nomSalle, ...) alors que l'appel passait
// (nomSalle, filiere, ...) : les deux valeurs se retrouvaient inversées à
// l'intérieur de la fonction, ce qui cassait à la fois le sigle et le nom de
// salle dans le code généré.
const genererCodeClasse = (nomSalle, filiere, niveau, formation) => {
  const salle = nomSalle.trim().replace(/\s+/g, '');
  const sigle =
    siglesNormalises[normalize(filiere)] ||
    filiere.split(' ').map(w => w[0]?.toUpperCase() || '').join('');
  // Format aligné sur l'aperçu du mobile (salle-sigle-niveau-formation),
  // ex: "D-GL-L1-FI"
  return `${salle}-${sigle}-${niveau}-${formation}`;
};

const CascadeController = {

  creerEtablissement: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { nom, ville, plan, emailAdmin, prenomAdmin, nomAdmin, logoUrl, gpsLat, gpsLng, gpsRayon } = req.body;

    try {
      const existingUser = await prisma.user.findUnique({ where: { email: emailAdmin } });
      if (existingUser) return res.status(409).json({ error: `L'email ${emailAdmin} est déjà utilisé` });

      const etablissement = await prisma.etablissement.create({
        data: {
          nom, ville, plan, logoUrl,
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
        etablissement: {
          id: etablissement.id, nom: etablissement.nom, ville: etablissement.ville,
          plan: etablissement.plan, gpsLat: etablissement.gpsLat,
          gpsLng: etablissement.gpsLng, gpsRayon: etablissement.gpsRayon,
        },
        admin: { id: admin.id, email: admin.email, prenom: admin.prenom, nom: admin.nom },
      });
    } catch (err) {
      console.error('[CreerEtablissement]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  creerDepartement: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { nom, description, emailChef, prenomChef, nomChef } = req.body;

    try {
      const admin = await prisma.user.findUnique({
        where: { id: req.user.id }, include: { etablissement: true },
      });
      if (!admin?.etablissementId) return res.status(400).json({ error: 'Admin sans établissement associé' });

      const existingUser = await prisma.user.findUnique({ where: { email: emailChef } });
      if (existingUser) return res.status(409).json({ error: `L'email ${emailChef} est déjà utilisé` });

      const departement = await prisma.departement.create({
        data: { nom, description, etablissementId: admin.etablissementId },
      });

      const tempPassword = generateTempPassword(emailChef.split('@')[0]);
      const passwordHash = await hashPassword(tempPassword);

      const chef = await prisma.user.create({
        data: {
          nom: nomChef, prenom: prenomChef, email: emailChef,
          passwordHash, role: 'chef_departement', statut: 'premier_login',
          etablissementId: admin.etablissementId, departementId: departement.id,
        },
      });

      await EmailService.sendChefCredentials({
        prenom: prenomChef, nom: nomChef, email: emailChef,
        password: tempPassword, departementNom: nom, etablissementNom: admin.etablissement.nom,
      });

      return res.status(201).json({
        message: `Département créé. Identifiants envoyés à ${emailChef}`,
        departement: { id: departement.id, nom: departement.nom, description: departement.description },
        chef: { id: chef.id, email: chef.email, prenom: chef.prenom, nom: chef.nom },
      });
    } catch (err) {
      console.error('[CreerDepartement]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  modifierDepartement: async (req, res) => {
    const { id } = req.params;
    const { nom, description } = req.body;
    try {
      const admin = await prisma.user.findUnique({ where: { id: req.user.id } });
      const dept  = await prisma.departement.findFirst({ where: { id, etablissementId: admin.etablissementId } });
      if (!dept) return res.status(404).json({ error: 'Département non trouvé' });
      const updated = await prisma.departement.update({ where: { id }, data: { nom, description } });
      return res.json({ departement: updated });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  supprimerDepartement: async (req, res) => {
    const { id } = req.params;
    try {
      const admin = await prisma.user.findUnique({ where: { id: req.user.id } });
      const dept  = await prisma.departement.findFirst({ where: { id, etablissementId: admin.etablissementId } });
      if (!dept) return res.status(404).json({ error: 'Département non trouvé' });
      await prisma.departement.delete({ where: { id } });
      return res.json({ message: 'Département supprimé' });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  creerClasse: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { nomSalle, filiere, niveau, formation, emailDelegue, prenomDelegue, nomDelegue } = req.body;

    try {
      const chef = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { departementChef: { include: { etablissement: true } } },
      });
      if (!chef?.departementId) return res.status(400).json({ error: 'Chef sans département associé' });

      const existingUser = await prisma.user.findUnique({ where: { email: emailDelegue } });
      if (existingUser) return res.status(409).json({ error: `L'email ${emailDelegue} est déjà utilisé` });

      const codeGenere     = genererCodeClasse(nomSalle, filiere, niveau, formation);
      const existingClasse = await prisma.classe.findUnique({ where: { codeGenere } });
      if (existingClasse) return res.status(409).json({ error: `Une classe avec le code ${codeGenere} existe déjà` });

      const classe = await prisma.classe.create({
        data: { nom: `${filiere} ${niveau} ${formation}`, filiere, niveau, formation, codeGenere, departementId: chef.departementId },
      });

      const tempPassword = generateTempPassword(codeGenere.toLowerCase());
      const passwordHash = await hashPassword(tempPassword);

      const delegue = await prisma.user.create({
        data: {
          nom: nomDelegue, prenom: prenomDelegue, email: emailDelegue,
          passwordHash, role: 'delegue', statut: 'premier_login',
          etablissementId: chef.etablissementId, departementId: chef.departementId,
          classeDelegueId: classe.id,
        },
      });

      await EmailService.sendDelegueCredentials({
        prenom: prenomDelegue, nom: nomDelegue, email: emailDelegue,
        password: tempPassword, classeCode: codeGenere, departementNom: chef.departementChef.nom,
      });

      return res.status(201).json({
        message: `Classe créée. Identifiants envoyés à ${emailDelegue}`,
        classe:  { id: classe.id, codeGenere, filiere, niveau, formation },
        delegue: { id: delegue.id, email: delegue.email, prenom: delegue.prenom, nom: delegue.nom },
      });
    } catch (err) {
      console.error('[CreerClasse]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  supprimerClasse: async (req, res) => {
    const { id } = req.params;
    try {
      const chef   = await prisma.user.findUnique({ where: { id: req.user.id } });
      const classe = await prisma.classe.findFirst({ where: { id, departementId: chef.departementId } });
      if (!classe) return res.status(404).json({ error: 'Classe non trouvée' });
      await prisma.classe.delete({ where: { id } });
      return res.json({ message: 'Classe supprimée' });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  getEtablissements: async (req, res) => {
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

  getDepartements: async (req, res) => {
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

  getClasses: async (req, res) => {
    try {
      const user  = await prisma.user.findUnique({ where: { id: req.user.id } });
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
  toggleStatutEtablissement: async (req, res) => {
  try {
    const etab = await prisma.etablissement.findUnique({
      where: { id: req.params.id },
    });
    if (!etab) return res.status(404).json({ error: 'Établissement introuvable' });

    const updated = await prisma.etablissement.update({
      where: { id: req.params.id },
      data:  { actif: !etab.actif },
    });

    return res.json({
      message: updated.actif ? 'Établissement activé' : 'Établissement désactivé',
      actif:   updated.actif,
    });
  } catch (err) {
    console.error('[Cascade] Toggle statut:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
},

togglePlanEtablissement: async (req, res) => {
  try {
    const etab = await prisma.etablissement.findUnique({
      where: { id: req.params.id },
    });
    if (!etab) return res.status(404).json({ error: 'Établissement introuvable' });

    const nouveauPlan = etab.plan === 'premium' ? 'free' : 'premium';
    const updated = await prisma.etablissement.update({
      where: { id: req.params.id },
      data:  { plan: nouveauPlan },
    });

    return res.json({
      message: `Plan changé en ${nouveauPlan}`,
      plan:    updated.plan,
    });
  } catch (err) {
    console.error('[Cascade] Toggle plan:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
},
};

module.exports = CascadeController;