const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

let messaging = null;

// ──────────────────────────────────────────────────────────────────
// Chargement des credentials Firebase :
//  1. Variables d'environnement (FIREBASE_PROJECT_ID / FIREBASE_PRIVATE_KEY /
//     FIREBASE_CLIENT_EMAIL) — utilisé en production (Docker, .env)
//  2. Repli : fichier JSON de service account (secrets/ à la racine du repo,
//     ou à la racine du repo, ou dans le dossier du service)
// ──────────────────────────────────────────────────────────────────
const loadServiceAccount = () => {
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

  if (projectId && privateKey && clientEmail) {
    // Docker/Compose peut échapper les \n — on les rétablit si besoin
    const key = privateKey.includes('\n') || !privateKey.includes('\\n')
      ? privateKey
      : privateKey.replace(/\\n/g, '\n');
    return {
      type: 'service_account',
      project_id: projectId,
      private_key: key,
      client_email: clientEmail,
    };
  }

  // Repli : fichiers JSON locaux (dev)
  const candidates = [
    path.join(__dirname, '../../../secrets/firebase-service-account.json'),
    path.join(__dirname, '../../../firebase-service-account.json'),
    path.join(__dirname, '../../../smartcampus-6d557-firebase-adminsdk-fbsvc-4ab60fbcdf.json'),
    path.join(__dirname, './firebase-service-account.json'),
  ];

  for (const file of candidates) {
    if (fs.existsSync(file)) {
      console.log(`[Firebase] Credentials chargés depuis ${file}`);
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  }

  return null;
};

const initFirebase = () => {
  try {
    const serviceAccount = loadServiceAccount();
    if (!serviceAccount) {
      console.error('[Firebase] Aucun credential trouvé — définissez FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY et FIREBASE_CLIENT_EMAIL');
      return;
    }
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    messaging = admin.messaging();
    console.log('[Firebase] Initialise avec succes');
  } catch (err) {
    console.error('[Firebase] Erreur init:', err.message);
  }
};

const sendPushToOne = async (fcmToken, titre, contenu, data = {}) => {
  if (!messaging || !fcmToken) return false;
  try {
    await messaging.send({
      token: fcmToken,
      notification: { title: titre, body: contenu },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: 'high',
        notification: { sound: 'default', channelId: 'edunotify_default' },
      },
    });
    return true;
  } catch (err) {
    console.warn('[Firebase] Push echec:', err.message);
    return false;
  }
};

const sendPushToMany = async (tokens, titre, contenu, data = {}) => {
  if (!messaging || !tokens.length) return;
  const validTokens = tokens.filter(Boolean);
  if (!validTokens.length) return;

  try {
    // sendMulticast envoie en une seule requête HTTP — évite les ECONNRESET
    const message = {
      tokens: validTokens,
      notification: { title: titre, body: contenu },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: 'high',
        notification: { sound: 'default', channelId: 'edunotify_default' },
      },
    };

    const response = await messaging.sendEachForMulticast(message);
    console.log(`[Firebase] OK: ${response.successCount} / Echecs: ${response.failureCount}`);

    // Nettoyer les tokens invalides
    if (response.failureCount > 0) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          console.warn(`[Firebase] Token invalide: ${validTokens[idx].substring(0, 20)}... — ${resp.error?.message}`);
        }
      });
    }
  } catch (err) {
    console.error('[Firebase] sendEachForMulticast erreur:', err.message);

    // Fallback : envoi séquentiel avec délai si multicast échoue
    for (const token of validTokens) {
      try {
        await sendPushToOne(token, titre, contenu, data);
        await new Promise(r => setTimeout(r, 100)); // 100ms entre chaque
      } catch (_) {}
    }
  }
};
module.exports = { initFirebase, sendPushToOne, sendPushToMany };

