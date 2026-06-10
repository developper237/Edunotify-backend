// shared/email/emailService.js

const nodemailer = require('nodemailer');

// ── Transporter Gmail ─────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// ── Template de base ──────────────────────────────────────────────
const baseTemplate = (content) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f1f5f9; }
    .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #0B0E1C 0%, #131629 100%); padding: 32px; text-align: center; }
    .header h1 { color: #06B6D4; font-size: 28px; font-weight: 800; letter-spacing: -0.5px; }
    .header p { color: #94A3B8; font-size: 13px; margin-top: 4px; }
    .body { padding: 32px; }
    .body h2 { color: #0F172A; font-size: 20px; font-weight: 700; margin-bottom: 12px; }
    .body p { color: #475569; font-size: 14px; line-height: 1.6; margin-bottom: 16px; }
    .credentials { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 20px 0; }
    .credentials .label { color: #94A3B8; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .credentials .value { color: #0F172A; font-size: 15px; font-weight: 700; font-family: monospace; }
    .credentials .row { margin-bottom: 14px; }
    .credentials .row:last-child { margin-bottom: 0; }
    .badge { display: inline-block; background: #06B6D4; color: white; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 20px; margin-bottom: 20px; }
    .warning { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; padding: 14px 16px; margin-top: 16px; }
    .warning p { color: #c2410c; font-size: 13px; margin: 0; }
    .footer { background: #f8fafc; padding: 20px 32px; text-align: center; border-top: 1px solid #e2e8f0; }
    .footer p { color: #94A3B8; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>EduNotify</h1>
      <p>Plateforme de gestion académique</p>
    </div>
    <div class="body">${content}</div>
    <div class="footer">
      <p>EduNotify &copy; ${new Date().getFullYear()} — Ne pas répondre à cet email</p>
    </div>
  </div>
</body>
</html>
`;

// ══════════════════════════════════════════════════════════════════
// TEMPLATES PAR RÔLE
// ══════════════════════════════════════════════════════════════════

const templates = {

  // ── Compte Admin Etablissement ──────────────────────────────────
  admin: ({ prenom, nom, email, password, etablissementNom }) =>
    baseTemplate(`
      <span class="badge">Administrateur</span>
      <h2>Bienvenue sur EduNotify, ${prenom} !</h2>
      <p>Un compte administrateur a été créé pour vous afin de gérer l'établissement <strong>${etablissementNom}</strong>.</p>
      <div class="credentials">
        <div class="row">
          <div class="label">Nom complet</div>
          <div class="value">${prenom} ${nom}</div>
        </div>
        <div class="row">
          <div class="label">Email de connexion</div>
          <div class="value">${email}</div>
        </div>
        <div class="row">
          <div class="label">Mot de passe temporaire</div>
          <div class="value">${password}</div>
        </div>
        <div class="row">
          <div class="label">Établissement</div>
          <div class="value">${etablissementNom}</div>
        </div>
      </div>
      <div class="warning">
        <p>⚠️ Vous devrez changer ce mot de passe lors de votre première connexion.</p>
      </div>
    `),

  // ── Compte Chef de Département ──────────────────────────────────
  chef_departement: ({ prenom, nom, email, password, departementNom, etablissementNom }) =>
    baseTemplate(`
      <span class="badge">Chef de Département</span>
      <h2>Bienvenue sur EduNotify, ${prenom} !</h2>
      <p>Un compte chef de département a été créé pour vous. Vous gérez le département <strong>${departementNom}</strong> de l'établissement <strong>${etablissementNom}</strong>.</p>
      <div class="credentials">
        <div class="row">
          <div class="label">Nom complet</div>
          <div class="value">${prenom} ${nom}</div>
        </div>
        <div class="row">
          <div class="label">Email de connexion</div>
          <div class="value">${email}</div>
        </div>
        <div class="row">
          <div class="label">Mot de passe temporaire</div>
          <div class="value">${password}</div>
        </div>
        <div class="row">
          <div class="label">Département</div>
          <div class="value">${departementNom}</div>
        </div>
      </div>
      <div class="warning">
        <p>⚠️ Vous devrez changer ce mot de passe lors de votre première connexion.</p>
      </div>
    `),

  // ── Compte Délégué ──────────────────────────────────────────────
  delegue: ({ prenom, nom, email, password, classeCode, departementNom }) =>
    baseTemplate(`
      <span class="badge">Délégué</span>
      <h2>Bienvenue sur EduNotify, ${prenom} !</h2>
      <p>Vous avez été désigné délégué de la classe <strong>${classeCode}</strong> du département <strong>${departementNom}</strong>.</p>
      <div class="credentials">
        <div class="row">
          <div class="label">Nom complet</div>
          <div class="value">${prenom} ${nom}</div>
        </div>
        <div class="row">
          <div class="label">Email de connexion</div>
          <div class="value">${email}</div>
        </div>
        <div class="row">
          <div class="label">Mot de passe temporaire</div>
          <div class="value">${password}</div>
        </div>
        <div class="row">
          <div class="label">Classe</div>
          <div class="value">${classeCode}</div>
        </div>
      </div>
      <div class="warning">
        <p>⚠️ Vous devrez changer ce mot de passe lors de votre première connexion. En tant que délégué, vous pourrez importer la liste des étudiants de votre classe.</p>
      </div>
    `),

  // ── Compte Étudiant (import CSV) ────────────────────────────────
  etudiant: ({ prenom, nom, email, password, matricule, classeCode }) =>
    baseTemplate(`
      <span class="badge">Étudiant</span>
      <h2>Bienvenue sur EduNotify, ${prenom} !</h2>
      <p>Votre compte étudiant a été créé. Vous pouvez désormais accéder à la plateforme pour consulter vos présences, notes et notifications.</p>
      <div class="credentials">
        <div class="row">
          <div class="label">Nom complet</div>
          <div class="value">${prenom} ${nom}</div>
        </div>
        <div class="row">
          <div class="label">Matricule</div>
          <div class="value">${matricule}</div>
        </div>
        <div class="row">
          <div class="label">Email de connexion</div>
          <div class="value">${email}</div>
        </div>
        <div class="row">
          <div class="label">Mot de passe temporaire</div>
          <div class="value">${password}</div>
        </div>
        <div class="row">
          <div class="label">Classe</div>
          <div class="value">${classeCode}</div>
        </div>
      </div>
      <div class="warning">
        <p>⚠️ Vous devrez changer ce mot de passe lors de votre première connexion.</p>
      </div>
    `),

  // ── Changement de mot de passe ──────────────────────────────────
  passwordChanged: ({ prenom }) =>
    baseTemplate(`
      <h2>Mot de passe modifié</h2>
      <p>Bonjour ${prenom},</p>
      <p>Votre mot de passe EduNotify a été modifié avec succès. Si vous n'êtes pas à l'origine de cette modification, contactez immédiatement votre administrateur.</p>
    `),
};

// ══════════════════════════════════════════════════════════════════
// FONCTIONS D'ENVOI
// ══════════════════════════════════════════════════════════════════

const sendEmail = async ({ to, subject, html }) => {
  try {
    const info = await transporter.sendMail({
      from: `"EduNotify" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      html,
    });
    console.log(`[Email] Envoyé à ${to} — MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`[Email] Erreur envoi à ${to}:`, error.message);
    return { success: false, error: error.message };
  }
};

const EmailService = {
  // Envoyer identifiants admin
  sendAdminCredentials: (data) =>
    sendEmail({
      to: data.email,
      subject: `[EduNotify] Vos identifiants administrateur — ${data.etablissementNom}`,
      html: templates.admin(data),
    }),

  // Envoyer identifiants chef département
  sendChefCredentials: (data) =>
    sendEmail({
      to: data.email,
      subject: `[EduNotify] Vos identifiants chef de département — ${data.departementNom}`,
      html: templates.chef_departement(data),
    }),

  // Envoyer identifiants délégué
  sendDelegueCredentials: (data) =>
    sendEmail({
      to: data.email,
      subject: `[EduNotify] Vos identifiants délégué — Classe ${data.classeCode}`,
      html: templates.delegue(data),
    }),

  // Envoyer identifiants étudiant
  sendEtudiantCredentials: (data) =>
    sendEmail({
      to: data.email,
      subject: `[EduNotify] Bienvenue — Vos identifiants de connexion`,
      html: templates.etudiant(data),
    }),

  // Envoyer confirmation changement mdp
  sendPasswordChanged: (data) =>
    sendEmail({
      to: data.email,
      subject: '[EduNotify] Mot de passe modifié',
      html: templates.passwordChanged(data),
    }),

  // Envoyer en masse (CSV import)
  sendBulkEtudiantCredentials: async (etudiants) => {
    const results = { success: 0, failed: 0, errors: [] };
    for (const etudiant of etudiants) {
      const result = await EmailService.sendEtudiantCredentials(etudiant);
      if (result.success) {
        results.success++;
      } else {
        results.failed++;
        results.errors.push({ email: etudiant.email, error: result.error });
      }
      // Délai 200ms entre chaque email pour éviter le rate limiting Gmail
      await new Promise(r => setTimeout(r, 200));
    }
    return results;
  },

  // Vérifier la connexion SMTP
  verify: async () => {
    try {
      await transporter.verify();
      console.log('[Email] Connexion SMTP Gmail OK');
      return true;
    } catch (error) {
      console.error('[Email] Erreur SMTP:', error.message);
      return false;
    }
  },
};

module.exports = EmailService;
