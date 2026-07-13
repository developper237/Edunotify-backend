// shared/email/emailService.js

const nodemailer = require('nodemailer');

// ── Transporter Gmail ─────────────────────────────────────────────
// host/port/secure explicites (au lieu de service: 'gmail') + family: 4
// pour forcer IPv4 directement au niveau du socket. Nécessaire car
// Render n'a pas de route IPv6 sortante vers Gmail (ENETUNREACH), et
// NODE_OPTIONS=--dns-result-order=ipv4first seul ne suffit pas à
// contourner ça de façon fiable avec le raccourci service: 'gmail'.
const transporter = nodemailer.createTransport({
  host: '74.125.140.108', // IP IPv4 directe de smtp.gmail.com
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
  tls: {
    // Requis car le certificat de Google est délivré pour "smtp.gmail.com", pas pour l'IP brute
    servername: 'smtp.gmail.com',
    rejectUnauthorized: false
  },
  connectionTimeout: 10000,
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

    /* HEADER */
    .header { background: linear-gradient(135deg, #0B1120 0%, #0D1526 50%, #0F1A2E 100%); padding: 36px 32px; text-align: center; }
    .header-logo { display: inline-flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .header-icon { width: 48px; height: 48px; background: linear-gradient(135deg, #1E88C8, #0EA5E9); border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; font-size: 24px; }
    .header h1 { color: #1E88C8; font-size: 26px; font-weight: 900; letter-spacing: -0.5px; }
    .header h1 span { color: #F97316; }
    .header-tagline { color: #64748B; font-size: 12px; margin-top: 4px; letter-spacing: 1px; text-transform: uppercase; }

    /* BANDE ACCENT */
    .accent-bar { height: 4px; background: linear-gradient(90deg, #1E88C8 0%, #F97316 50%, #1E88C8 100%); }

    /* CORPS */
    .body { padding: 36px 32px; }
    .body h2 { color: #0B1120; font-size: 20px; font-weight: 800; margin-bottom: 10px; }
    .body p { color: #475569; font-size: 14px; line-height: 1.7; margin-bottom: 14px; }

    /* BADGE RÔLE */
    .badge {
      display: inline-block;
      background: linear-gradient(135deg, #1E88C8, #0EA5E9);
      color: white;
      font-size: 11px;
      font-weight: 700;
      padding: 5px 14px;
      border-radius: 20px;
      margin-bottom: 18px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .badge.orange { background: linear-gradient(135deg, #F97316, #FB923C); }

    /* CARTE IDENTIFIANTS */
    .credentials {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-left: 4px solid #1E88C8;
      border-radius: 12px;
      padding: 22px;
      margin: 22px 0;
    }
    .credentials .row { margin-bottom: 16px; }
    .credentials .row:last-child { margin-bottom: 0; }
    .credentials .label {
      color: #94A3B8;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 3px;
    }
    .credentials .value {
      color: #0B1120;
      font-size: 15px;
      font-weight: 700;
      font-family: 'Courier New', monospace;
    }
    .credentials .value.highlight {
      color: #1E88C8;
      background: #EFF6FF;
      display: inline-block;
      padding: 3px 10px;
      border-radius: 6px;
      border: 1px solid #BFDBFE;
    }

    /* AVERTISSEMENT */
    .warning {
      background: #FFF7ED;
      border: 1px solid #FED7AA;
      border-left: 4px solid #F97316;
      border-radius: 10px;
      padding: 14px 16px;
      margin-top: 18px;
    }
    .warning p { color: #9A3412; font-size: 13px; margin: 0; font-weight: 500; }

    /* SUCCÈS */
    .success {
      background: #F0FDF4;
      border: 1px solid #BBF7D0;
      border-left: 4px solid #22C55E;
      border-radius: 10px;
      padding: 14px 16px;
      margin-top: 18px;
    }
    .success p { color: #166534; font-size: 13px; margin: 0; font-weight: 500; }

    /* ÉTAPES */
    .steps { margin: 20px 0; }
    .step { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
    .step-num {
      min-width: 24px; height: 24px;
      background: #1E88C8;
      color: white;
      font-size: 12px;
      font-weight: 700;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
    }
    .step-text { color: #475569; font-size: 13px; line-height: 1.5; padding-top: 3px; }

    /* FOOTER */
    .footer { background: #0B1120; padding: 24px 32px; text-align: center; }
    .footer-brand { color: #FFFFFF; font-size: 14px; font-weight: 800; margin-bottom: 4px; }
    .footer-brand span { color: #F97316; }
    .footer p { color: #475569; font-size: 11px; margin-top: 6px; }
    .footer-divider { width: 40px; height: 2px; background: linear-gradient(90deg, #1E88C8, #F97316); margin: 10px auto; border-radius: 2px; }
  </style>
</head>
<body>
  <div class="container">

    <div class="header">
      <div class="header-logo">
        <div class="header-icon">🎓</div>
      </div>
      <h1>Smart<span>Campus</span></h1>
      <div class="header-tagline">Learn · Grow · Succeed</div>
    </div>

    <div class="accent-bar"></div>

    <div class="body">${content}</div>

    <div class="footer">
      <div class="footer-brand">Smart<span>Campus</span></div>
      <div class="footer-divider"></div>
      <p>© ${new Date().getFullYear()} SmartCampus — Plateforme de gestion académique</p>
      <p style="margin-top:4px;">Ne pas répondre à cet email automatique</p>
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
      <h2>Bienvenue sur SmartCampus, ${prenom} !</h2>
      <p>Un compte administrateur a été créé pour vous afin de gérer l'établissement <strong>${etablissementNom}</strong>. Vous pouvez désormais configurer les départements, classes et comptes de votre établissement.</p>

      <div class="credentials">
        <div class="row">
          <div class="label">Nom complet</div>
          <div class="value">${prenom} ${nom}</div>
        </div>
        <div class="row">
          <div class="label">Email de connexion</div>
          <div class="value highlight">${email}</div>
        </div>
        <div class="row">
          <div class="label">Mot de passe temporaire</div>
          <div class="value highlight">${password}</div>
        </div>
        <div class="row">
          <div class="label">Établissement</div>
          <div class="value">${etablissementNom}</div>
        </div>
      </div>

      <div class="steps">
        <div class="step">
          <div class="step-num">1</div>
          <div class="step-text">Connectez-vous avec les identifiants ci-dessus</div>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <div class="step-text">Changez votre mot de passe lors de la première connexion</div>
        </div>
        <div class="step">
          <div class="step-num">3</div>
          <div class="step-text">Configurez votre établissement et invitez vos équipes</div>
        </div>
      </div>

      <div class="warning">
        <p>⚠️ Ce mot de passe est temporaire. Vous serez invité à le changer dès votre première connexion.</p>
      </div>
    `),

  // ── Compte Chef de Département ──────────────────────────────────
  chef_departement: ({ prenom, nom, email, password, departementNom, etablissementNom }) =>
    baseTemplate(`
      <span class="badge">Chef de Département</span>
      <h2>Bienvenue sur SmartCampus, ${prenom} !</h2>
      <p>Un compte chef de département a été créé pour vous. Vous gérez le département <strong>${departementNom}</strong> de l'établissement <strong>${etablissementNom}</strong>.</p>

      <div class="credentials">
        <div class="row">
          <div class="label">Nom complet</div>
          <div class="value">${prenom} ${nom}</div>
        </div>
        <div class="row">
          <div class="label">Email de connexion</div>
          <div class="value highlight">${email}</div>
        </div>
        <div class="row">
          <div class="label">Mot de passe temporaire</div>
          <div class="value highlight">${password}</div>
        </div>
        <div class="row">
          <div class="label">Département</div>
          <div class="value">${departementNom}</div>
        </div>
        <div class="row">
          <div class="label">Établissement</div>
          <div class="value">${etablissementNom}</div>
        </div>
      </div>

      <div class="steps">
        <div class="step">
          <div class="step-num">1</div>
          <div class="step-text">Connectez-vous avec les identifiants ci-dessus</div>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <div class="step-text">Changez votre mot de passe lors de la première connexion</div>
        </div>
        <div class="step">
          <div class="step-num">3</div>
          <div class="step-text">Gérez vos classes, publiez les notes et communiquez avec vos étudiants</div>
        </div>
      </div>

      <div class="warning">
        <p>⚠️ Ce mot de passe est temporaire. Vous serez invité à le changer dès votre première connexion.</p>
      </div>
    `),

  // ── Compte Délégué ──────────────────────────────────────────────
  delegue: ({ prenom, nom, email, password, classeCode, departementNom }) =>
    baseTemplate(`
      <span class="badge orange">Délégué de classe</span>
      <h2>Bienvenue sur SmartCampus, ${prenom} !</h2>
      <p>Félicitations ! Vous avez été désigné délégué de la classe <strong>${classeCode}</strong> du département <strong>${departementNom}</strong>. Ce rôle vous permettra de gérer les appels de présence et de communiquer avec vos camarades.</p>

      <div class="credentials">
        <div class="row">
          <div class="label">Nom complet</div>
          <div class="value">${prenom} ${nom}</div>
        </div>
        <div class="row">
          <div class="label">Email de connexion</div>
          <div class="value highlight">${email}</div>
        </div>
        <div class="row">
          <div class="label">Mot de passe temporaire</div>
          <div class="value highlight">${password}</div>
        </div>
        <div class="row">
          <div class="label">Classe</div>
          <div class="value">${classeCode}</div>
        </div>
        <div class="row">
          <div class="label">Département</div>
          <div class="value">${departementNom}</div>
        </div>
      </div>

      <div class="steps">
        <div class="step">
          <div class="step-num">1</div>
          <div class="step-text">Connectez-vous et changez votre mot de passe</div>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <div class="step-text">Importez la liste CSV de vos camarades</div>
        </div>
        <div class="step">
          <div class="step-num">3</div>
          <div class="step-text">Lancez les appels de présence et envoyez des notifications</div>
        </div>
      </div>

      <div class="warning">
        <p>⚠️ Ce mot de passe est temporaire. Vous serez invité à le changer dès votre première connexion.</p>
      </div>
    `),

  // ── Compte Étudiant (import CSV) ────────────────────────────────
  etudiant: ({ prenom, nom, email, password, matricule, classeCode }) =>
    baseTemplate(`
      <span class="badge">Étudiant</span>
      <h2>Bienvenue sur SmartCampus, ${prenom} !</h2>
      <p>Votre compte étudiant a été créé. Vous pouvez désormais accéder à la plateforme pour consulter vos présences, notes et notifications de votre établissement.</p>

      <div class="credentials">
        <div class="row">
          <div class="label">Nom complet</div>
          <div class="value">${prenom} ${nom}</div>
        </div>
        <div class="row">
          <div class="label">Matricule</div>
          <div class="value highlight">${matricule}</div>
        </div>
        <div class="row">
          <div class="label">Email de connexion</div>
          <div class="value highlight">${email}</div>
        </div>
        <div class="row">
          <div class="label">Mot de passe temporaire</div>
          <div class="value highlight">${password}</div>
        </div>
        <div class="row">
          <div class="label">Classe</div>
          <div class="value">${classeCode}</div>
        </div>
      </div>

      <div class="steps">
        <div class="step">
          <div class="step-num">1</div>
          <div class="step-text">Téléchargez l'application SmartCampus</div>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <div class="step-text">Connectez-vous avec votre email et mot de passe temporaire</div>
        </div>
        <div class="step">
          <div class="step-num">3</div>
          <div class="step-text">Choisissez un nouveau mot de passe personnel</div>
        </div>
      </div>

      <div class="warning">
        <p>⚠️ Ce mot de passe est temporaire. Vous serez invité à le changer dès votre première connexion.</p>
      </div>
    `),

  // ── Changement de mot de passe ──────────────────────────────────
  passwordChanged: ({ prenom }) =>
    baseTemplate(`
      <h2>Mot de passe modifié ✓</h2>
      <p>Bonjour <strong>${prenom}</strong>,</p>
      <p>Votre mot de passe SmartCampus a été modifié avec succès. Votre compte est maintenant pleinement actif.</p>

      <div class="success">
        <p>✅ Votre compte est activé. Vous pouvez utiliser toutes les fonctionnalités de SmartCampus.</p>
      </div>

      <p style="margin-top: 20px; color: #94A3B8; font-size: 13px;">
        Si vous n'êtes pas à l'origine de cette modification, contactez immédiatement votre administrateur.
      </p>
    `),

  // ── Code de réinitialisation de mot de passe (mot de passe oublié) ──
  passwordReset: ({ prenom, code }) =>
    baseTemplate(`
      <h2>Réinitialisation de mot de passe</h2>
      <p>Bonjour <strong>${prenom}</strong>,</p>
      <p>Vous avez demandé la réinitialisation de votre mot de passe SmartCampus. Utilisez le code ci-dessous dans l'application pour définir un nouveau mot de passe.</p>

      <div class="credentials" style="text-align:center;">
        <div class="label">Code de vérification</div>
        <div class="value highlight" style="font-size:28px; letter-spacing:6px; padding:8px 16px;">${code}</div>
      </div>

      <div class="warning">
        <p>⚠️ Ce code expire dans 10 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email — votre mot de passe restera inchangé.</p>
      </div>
    `),
};

// ══════════════════════════════════════════════════════════════════
// FONCTIONS D'ENVOI
// ══════════════════════════════════════════════════════════════════

const sendEmail = async ({ to, subject, html }) => {
  try {
    const info = await transporter.sendMail({
      from: `"SmartCampus" <${process.env.GMAIL_USER}>`,
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
  sendAdminCredentials: (data) =>
    sendEmail({
      to:      data.email,
      subject: `[SmartCampus] Vos identifiants administrateur — ${data.etablissementNom}`,
      html:    templates.admin(data),
    }),

  sendChefCredentials: (data) =>
    sendEmail({
      to:      data.email,
      subject: `[SmartCampus] Vos identifiants chef de département — ${data.departementNom}`,
      html:    templates.chef_departement(data),
    }),

  sendDelegueCredentials: (data) =>
    sendEmail({
      to:      data.email,
      subject: `[SmartCampus] Vos identifiants délégué — Classe ${data.classeCode}`,
      html:    templates.delegue(data),
    }),

  sendEtudiantCredentials: (data) =>
    sendEmail({
      to:      data.email,
      subject: `[SmartCampus] Bienvenue — Vos identifiants de connexion`,
      html:    templates.etudiant(data),
    }),

  sendPasswordChanged: (data) =>
    sendEmail({
      to:      data.email,
      subject: '[SmartCampus] Compte activé — Mot de passe modifié',
      html:    templates.passwordChanged(data),
    }),

  sendPasswordResetCode: (data) =>
    sendEmail({
      to:      data.email,
      subject: '[SmartCampus] Votre code de réinitialisation de mot de passe',
      html:    templates.passwordReset(data),
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