// shared/email/emailService.js
// Utilise l'API HTTP Brevo (port 443) au lieu du SMTP (ports bloqués sur Render gratuit)

const https = require('https');

// ══════════════════════════════════════════════════════════════════
// FONCTION PRINCIPALE — Envoyer via API HTTP Brevo
// ══════════════════════════════════════════════════════════════════

const sendEmailBrevo = (to, subject, htmlContent) => {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      sender:   { name: 'SmartCampus', email: process.env.BREVO_FROM_EMAIL || 'noreply@smartcampus.cm' },
      to:       [{ email: to }],
      subject,
      htmlContent,
    });

    const options = {
      hostname: 'api.brevo.com',
      path:     '/v3/smtp/email',
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'api-key':        process.env.BREVO_API_KEY || '',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[Email] Envoyé à ${to} — status ${res.statusCode}`);
          resolve({ success: true, statusCode: res.statusCode });
        } else {
          console.error(`[Email] Erreur Brevo ${res.statusCode}:`, data);
          reject(new Error(`Brevo API error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (err) => {
      console.error('[Email] Erreur réseau:', err.message);
      reject(err);
    });

    req.write(payload);
    req.end();
  });
};

// ══════════════════════════════════════════════════════════════════
// TEMPLATES
// ══════════════════════════════════════════════════════════════════

const buildTemplate = (title, preheader, bodyContent) => `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#F0F4F8;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F4F8;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- HEADER -->
        <tr>
          <td style="background:#0B1120;border-radius:12px 12px 0 0;padding:28px 32px;text-align:center;">
            <h1 style="margin:0;font-size:26px;font-weight:900;letter-spacing:-0.5px;">
              <span style="color:#FFFFFF;">Smart</span><span style="color:#F97316;">Campus</span>
            </h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.5);font-size:12px;letter-spacing:1px;text-transform:uppercase;">Plateforme de gestion académique</p>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="background:#FFFFFF;padding:36px 32px;">
            ${bodyContent}
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background:#0B1120;border-radius:0 0 12px 12px;padding:20px 32px;text-align:center;">
            <p style="margin:0 0 4px;font-size:14px;font-weight:800;">
              <span style="color:#FFFFFF;">Smart</span><span style="color:#F97316;">Campus</span>
            </p>
            <p style="margin:0;color:rgba(255,255,255,0.4);font-size:11px;">
              Ce message est généré automatiquement — ne pas répondre directement.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

// ══════════════════════════════════════════════════════════════════
// EMAILS MÉTIER
// ══════════════════════════════════════════════════════════════════

const sendWelcomeEmail = async (to, prenom, motDePasse) => {
  const body = `
    <h2 style="color:#0B1120;font-size:22px;margin:0 0 8px;">Bienvenue, ${prenom} 👋</h2>
    <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 24px;">
      Votre compte SmartCampus a été créé avec succès. Voici vos identifiants de connexion :
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td style="background:#F8F9FA;border-radius:8px;padding:20px 24px;">
          <p style="margin:0 0 8px;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Email</p>
          <p style="margin:0;color:#0B1120;font-size:16px;font-weight:600;">${to}</p>
          <p style="margin:16px 0 8px;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Mot de passe temporaire</p>
          <p style="margin:0;color:#F97316;font-size:22px;font-weight:800;letter-spacing:2px;font-family:monospace;">${motDePasse}</p>
        </td>
      </tr>
    </table>
    <div style="background:#FFF7ED;border-left:4px solid #F97316;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:24px;">
      <p style="margin:0;color:#92400E;font-size:13px;">
        ⚠️ Pour des raisons de sécurité, vous devrez changer ce mot de passe lors de votre première connexion.
      </p>
    </div>
    <p style="color:#555;font-size:13px;margin:0;">
      En cas de problème, contactez l'administration de votre établissement.
    </p>`;

  return sendEmailBrevo(
    to,
    'Bienvenue sur SmartCampus — Vos identifiants',
    buildTemplate('Bienvenue sur SmartCampus', `Mot de passe temporaire : ${motDePasse}`, body)
  );
};

const sendPasswordResetEmail = async (to, prenom, otp) => {
  const body = `
    <h2 style="color:#0B1120;font-size:22px;margin:0 0 8px;">Réinitialisation de mot de passe</h2>
    <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 24px;">
      Bonjour ${prenom}, voici votre code de réinitialisation :
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td align="center" style="background:#F8F9FA;border-radius:12px;padding:28px;">
          <p style="margin:0 0 8px;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Code OTP</p>
          <p style="margin:0;color:#0B1120;font-size:36px;font-weight:900;letter-spacing:8px;font-family:monospace;">${otp}</p>
          <p style="margin:12px 0 0;color:#F97316;font-size:12px;font-weight:600;">⏱ Valable 15 minutes</p>
        </td>
      </tr>
    </table>
    <div style="background:#FEF2F2;border-left:4px solid #EF4444;border-radius:0 8px 8px 0;padding:14px 18px;">
      <p style="margin:0;color:#991B1B;font-size:13px;">
        🔒 Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.
      </p>
    </div>`;

  return sendEmailBrevo(
    to,
    'SmartCampus — Code de réinitialisation',
    buildTemplate('Réinitialisation', `Votre code OTP : ${otp}`, body)
  );
};

const sendNotePublishedEmail = async (to, prenom, publication, moyenne) => {
  const admis = moyenne >= 10;
  const body = `
    <h2 style="color:#0B1120;font-size:22px;margin:0 0 8px;">📋 Nouvelles notes disponibles</h2>
    <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 24px;">
      Bonjour ${prenom}, vos résultats pour <strong>${publication}</strong> ont été publiés.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td align="center" style="background:${admis ? '#F0FDF4' : '#FFF7ED'};border-radius:12px;padding:28px;">
          <p style="margin:0 0 4px;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Moyenne générale</p>
          <p style="margin:0;color:${admis ? '#16A34A' : '#EA580C'};font-size:40px;font-weight:900;">${moyenne}/20</p>
          <p style="margin:12px 0 0;display:inline-block;background:${admis ? '#16A34A' : '#EA580C'};color:white;padding:4px 16px;border-radius:20px;font-size:12px;font-weight:700;">
            ${admis ? '✅ ADMIS' : '⚠️ À RATTRAPER'}
          </p>
        </td>
      </tr>
    </table>
    <p style="color:#555;font-size:13px;margin:0;">
      Connectez-vous sur SmartCampus pour consulter le détail de vos notes et soumettre une requête si nécessaire.
    </p>`;

  return sendEmailBrevo(
    to,
    `SmartCampus — Résultats ${publication}`,
    buildTemplate('Notes publiées', `Votre moyenne : ${moyenne}/20`, body)
  );
};

const sendRapportEmail = async (to, prenomChef, delegueNom, matiere, taux) => {
  const body = `
    <h2 style="color:#0B1120;font-size:22px;margin:0 0 8px;">📊 Nouveau rapport d'appel</h2>
    <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 24px;">
      Bonjour ${prenomChef}, le délégué <strong>${delegueNom}</strong> vous a transmis un rapport de présence.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td style="background:#F8F9FA;border-radius:8px;padding:20px 24px;">
          <p style="margin:0 0 6px;color:#888;font-size:12px;">Matière</p>
          <p style="margin:0 0 16px;color:#0B1120;font-size:16px;font-weight:600;">${matiere}</p>
          <p style="margin:0 0 6px;color:#888;font-size:12px;">Taux de présence</p>
          <p style="margin:0;color:${taux >= 75 ? '#16A34A' : taux >= 50 ? '#EA580C' : '#DC2626'};font-size:28px;font-weight:900;">${taux}%</p>
        </td>
      </tr>
    </table>
    <p style="color:#555;font-size:13px;margin:0;">
      Consultez le rapport PDF complet dans l'onglet <strong>Rapports</strong> de SmartCampus.
    </p>`;

  return sendEmailBrevo(
    to,
    `SmartCampus — Rapport d'appel : ${matiere}`,
    buildTemplate("Rapport d'appel", `Taux de présence : ${taux}%`, body)
  );
};

// ══════════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════════

module.exports = {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendNotePublishedEmail,
  sendRapportEmail,
};