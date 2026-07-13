// shared/email/emailService.js
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'sergende695@gmail.com';
const FROM_NAME  = 'SmartCampus';

// ── Envoi centralisé ─────────────────────────────────────────────
async function sendMail({ to, subject, html }) {
  await sgMail.send({
    to,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject,
    html,
  });
}

// ══════════════════════════════════════════════════════════════════
// BASE TEMPLATE — compatible Gmail + Outlook (table-based)
// ══════════════════════════════════════════════════════════════════

const baseTemplate = ({ titre, contenu, footer = '' }) => `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${titre}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">

<table width="100%" bgcolor="#f4f6f8" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

        <!-- HEADER -->
        <tr>
          <td>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="#0D1117" align="center"
                    style="background-color:#0D1117;padding:32px 24px 20px 24px;border-radius:12px 12px 0 0;">
                  <table cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td align="center" style="padding-bottom:14px;">
                        <table cellpadding="0" cellspacing="0" border="0">
                          <tr>
                            <td bgcolor="#1A6E8E" align="center" valign="middle"
                                style="background-color:#1A6E8E;width:56px;height:56px;border-radius:14px;text-align:center;">
                              <span style="font-size:28px;line-height:56px;">🎓</span>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" style="padding-bottom:6px;">
                        <span style="font-family:Arial,sans-serif;font-size:26px;font-weight:bold;letter-spacing:-0.5px;">
                          <span style="color:#FFFFFF;">Smart</span><span style="color:#F97316;">Campus</span>
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td align="center">
                        <span style="font-family:Arial,sans-serif;font-size:11px;color:#9CA3AF;letter-spacing:3px;">
                          LEARN &middot; GROW &middot; SUCCEED
                        </span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:36px 40px 32px 40px;">
            ${contenu}
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="#0D1117" align="center"
                    style="background-color:#0D1117;padding:20px 24px;border-radius:0 0 12px 12px;">
                  ${footer}
                  <p style="margin:8px 0 0 0;font-family:Arial,sans-serif;font-size:12px;color:#6B7280;">
                    &copy; 2026 SmartCampus &mdash; Plateforme de gestion acad&eacute;mique<br>
                    <span style="color:#4B5563;">Ne pas r&eacute;pondre &agrave; cet email automatique</span>
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>`;

// ── Blocs réutilisables ──────────────────────────────────────────
const infoBlock = (texte, couleur = '#1A6E8E', bg = '#EFF6FF') => `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
  <tr>
    <td width="4" bgcolor="${couleur}" style="background-color:${couleur};border-radius:4px;">&nbsp;</td>
    <td bgcolor="${bg}" style="background-color:${bg};padding:14px 16px;border-radius:0 8px 8px 0;">
      <span style="font-family:Arial,sans-serif;font-size:14px;color:#1F2937;line-height:1.6;">${texte}</span>
    </td>
  </tr>
</table>`;

const successBlock = (texte) => infoBlock(texte, '#16A34A', '#F0FDF4');
const alertBlock   = (texte) => infoBlock(texte, '#F97316', '#FFF7ED');

const credentialBlock = (lignes) => `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
  <tr>
    <td bgcolor="#F9FAFB" style="background-color:#F9FAFB;padding:20px 24px;border-radius:10px;border:1px solid #E5E7EB;">
      ${lignes.map(({ label, value }) => `
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;">
          <tr><td style="font-family:Arial,sans-serif;font-size:12px;color:#6B7280;padding-bottom:2px;">${label}</td></tr>
          <tr><td style="font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:#111827;">${value}</td></tr>
        </table>
      `).join('')}
    </td>
  </tr>
</table>`;

const para = (texte, opts = '') => `
<p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;line-height:1.7;margin:0 0 16px 0;${opts}">${texte}</p>`;

const h1 = (texte) => `
<h1 style="font-family:Arial,sans-serif;font-size:22px;font-weight:bold;color:#111827;margin:0 0 8px 0;line-height:1.3;">${texte}</h1>`;

const separator = () => `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
  <tr><td height="1" bgcolor="#E5E7EB" style="background-color:#E5E7EB;line-height:1px;font-size:1px;">&nbsp;</td></tr>
</table>`;

const footerLogo = () => `
<span style="font-family:Arial,sans-serif;font-size:18px;font-weight:bold;">
  <span style="color:#FFFFFF;">Smart</span><span style="color:#F97316;">Campus</span>
</span>`;

// ══════════════════════════════════════════════════════════════════
// TEMPLATES
// ══════════════════════════════════════════════════════════════════

const EmailService = {

  // ── Vérification connexion ─────────────────────────────────────
  async verify() {
    // SendGrid n'a pas de verify() — on teste juste que la clé est définie
    if (!process.env.SENDGRID_API_KEY) {
      throw new Error('SENDGRID_API_KEY manquante');
    }
    console.log('[Email] SendGrid configuré ✓');
  },

  // ── Bienvenue / Compte créé ────────────────────────────────────
  async sendWelcome({ email, prenom, nom, role, matricule, motDePasse }) {
    const roleLabel = {
      etudiant:         'Étudiant(e)',
      delegue:          'Délégué(e) de classe',
      chef_departement: 'Chef de département',
      admin:            'Administrateur',
    }[role] || role;

    const html = baseTemplate({
      titre:   'Bienvenue sur SmartCampus',
      contenu: `
        ${h1('Bienvenue sur SmartCampus ! 🎉')}
        ${para(`Bonjour <strong>${prenom} ${nom}</strong>,`)}
        ${para("Votre compte a été créé avec succès. Connectez-vous à l'application EduNotify avec les identifiants ci-dessous.")}
        ${credentialBlock([
          { label: 'Profil',                   value: roleLabel },
          ...(matricule ? [{ label: 'Matricule', value: matricule }] : []),
          { label: 'Email',                    value: email },
          { label: 'Mot de passe temporaire',  value: motDePasse },
        ])}
        ${alertBlock('⚠️ Vous devrez changer ce mot de passe lors de votre première connexion.')}
        ${separator()}
        ${para("Si vous n'êtes pas à l'origine de cette création de compte, contactez immédiatement l'administrateur.", 'font-size:13px;color:#6B7280;')}
      `,
      footer: footerLogo(),
    });

    await sendMail({
      to:      email,
      subject: '[SmartCampus] Bienvenue — Vos identifiants de connexion',
      html,
    });
  },

  // ── Credentials délégué ───────────────────────────────────────
  async sendDelegueCredentials({ email, prenom, nom, classe, matricule, motDePasse }) {
    const html = baseTemplate({
      titre:   'Vos identifiants délégué',
      contenu: `
        ${h1('Vous êtes délégué de classe 🎖️')}
        ${para(`Bonjour <strong>${prenom} ${nom}</strong>,`)}
        ${para(`Vous avez été désigné(e) <strong>délégué(e)</strong> de la classe <strong>${classe}</strong>. Voici vos identifiants :`)}
        ${credentialBlock([
          { label: 'Classe',                  value: classe },
          { label: 'Matricule',               value: matricule },
          { label: 'Email',                   value: email },
          { label: 'Mot de passe temporaire', value: motDePasse },
        ])}
        ${alertBlock('⚠️ Changez ce mot de passe lors de votre première connexion.')}
        ${separator()}
        ${para("En tant que délégué, vous pouvez lancer les sessions de présence, valider manuellement les étudiants et envoyer les rapports d'appel.", 'font-size:13px;color:#6B7280;')}
      `,
      footer: footerLogo(),
    });

    await sendMail({
      to:      email,
      subject: `[SmartCampus] Vos identifiants délégué — ${classe}`,
      html,
    });
  },

  // ── Mot de passe modifié ───────────────────────────────────────
  async sendPasswordChanged({ email, prenom }) {
    const html = baseTemplate({
      titre:   'Mot de passe modifié',
      contenu: `
        ${h1('Mot de passe modifié ✓')}
        ${para(`Bonjour <strong>${prenom}</strong>,`)}
        ${para('Votre mot de passe SmartCampus a été modifié avec succès. Votre compte est maintenant pleinement actif.')}
        ${successBlock('Votre compte est activé. Vous pouvez utiliser toutes les fonctionnalités de SmartCampus.')}
        ${separator()}
        ${para("Si vous n'êtes pas à l'origine de cette modification, contactez immédiatement votre administrateur.", 'font-size:13px;color:#6B7280;')}
      `,
      footer: footerLogo(),
    });

    await sendMail({
      to:      email,
      subject: '[SmartCampus] Compte activé — Mot de passe modifié',
      html,
    });
  },

  // ── Reset mot de passe ─────────────────────────────────────────
  async sendPasswordReset({ email, prenom, nouveauMotDePasse }) {
    const html = baseTemplate({
      titre:   'Réinitialisation de mot de passe',
      contenu: `
        ${h1('Réinitialisation de mot de passe 🔑')}
        ${para(`Bonjour <strong>${prenom}</strong>,`)}
        ${para('Une réinitialisation de mot de passe a été effectuée pour votre compte. Voici votre nouveau mot de passe temporaire :')}
        ${credentialBlock([
          { label: 'Nouveau mot de passe temporaire', value: nouveauMotDePasse },
        ])}
        ${alertBlock('⚠️ Connectez-vous et changez ce mot de passe immédiatement depuis votre profil.')}
        ${separator()}
        ${para("Si vous n'avez pas demandé cette réinitialisation, contactez immédiatement votre administrateur.", 'font-size:13px;color:#6B7280;')}
      `,
      footer: footerLogo(),
    });

    await sendMail({
      to:      email,
      subject: '[SmartCampus] Réinitialisation de votre mot de passe',
      html,
    });
  },

  // ── Import CSV — résumé ────────────────────────────────────────
  async sendImportSummary({ email, prenom, created, skipped, errors }) {
    const html = baseTemplate({
      titre:   "Résumé de l'import CSV",
      contenu: `
        ${h1('Import CSV terminé ✓')}
        ${para(`Bonjour <strong>${prenom}</strong>,`)}
        ${para("L'importation de la liste de votre classe est terminée. Voici le résumé :")}
        ${credentialBlock([
          { label: '✅ Comptes créés',    value: `${created} étudiant(s)` },
          { label: '⚠️ Lignes ignorées',  value: `${skipped} ligne(s)` },
          ...(errors.length > 0
            ? [{ label: '❌ Erreurs', value: errors.slice(0, 3).join(' | ') }]
            : []),
        ])}
        ${created > 0
          ? successBlock(`${created} compte(s) créé(s) avec succès. Chaque étudiant a reçu ses identifiants par email.`)
          : alertBlock("Aucun compte n'a été créé. Vérifiez le format de votre fichier CSV.")}
      `,
      footer: footerLogo(),
    });

    await sendMail({
      to:      email,
      subject: "[SmartCampus] Résumé de l'import CSV",
      html,
    });
  },

  // ── Notification générale ──────────────────────────────────────
  async sendNotification({ email, prenom, titreNotif, contenuNotif, categorie = 'administratif' }) {
    const couleur = {
      examen:        '#F97316',
      resultat:      '#16A34A',
      cours:         '#1A6E8E',
      administratif: '#7C3AED',
    }[categorie] || '#1A6E8E';

    const html = baseTemplate({
      titre:   titreNotif,
      contenu: `
        ${h1(titreNotif)}
        ${para(`Bonjour <strong>${prenom}</strong>,`)}
        ${infoBlock(contenuNotif, couleur, '#F5F3FF')}
        ${para('Connectez-vous à SmartCampus pour plus de détails.')}
      `,
      footer: footerLogo(),
    });

    await sendMail({
      to:      email,
      subject: `[SmartCampus] ${titreNotif}`,
      html,
    });
  },
};

module.exports = EmailService;