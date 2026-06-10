const admin = require('firebase-admin');
const path  = require('path');

let messaging = null;

const initFirebase = () => {
  try {
    const serviceAccount = require(path.join(__dirname, '../../../secrets/firebase-service-account.json'));
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
    const response = await messaging.sendEach(
      validTokens.map(token => ({
        token,
        notification: { title: titre, body: contenu },
        data: Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v)])
        ),
        android: {
          priority: 'high',
          notification: { sound: 'default', channelId: 'edunotify_default' },
        },
      }))
    );
    console.log('[Firebase] OK:', response.successCount, '/ Echecs:', response.failureCount);
  } catch (err) {
    console.error('[Firebase] sendEach erreur:', err.message);
  }
};

module.exports = { initFirebase, sendPushToOne, sendPushToMany };

