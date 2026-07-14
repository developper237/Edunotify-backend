if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });
}
const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');

const authRoutes    = require('./routes/auth.routes');
const accountRoutes = require('./routes/account.routes');
const cascadeRoutes = require('./routes/cascade.routes');
const csvRoutes     = require('./routes/csv.routes');
const { connectDB } = require('./utils/db');
const EmailService  = require('../../../shared/email/emailService');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middlewares ───────────────────────────────────────────────────
app.use(helmet());
app.use(cors()); // Autorise toutes les origines (indispensable pour le mobile)
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Configuration du Rate Limiting (Ajustée pour les tests) ───────
// On augmente les limites pour éviter de se faire bloquer pendant les tests mobiles
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500, // Augmenté de 100 à 500
  message: { error: 'Trop de requêtes, réessayez plus tard' },
});
app.use(globalLimiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50, // Augmenté de 10 à 50 pour tes tests
  message: { error: 'Trop de tentatives de connexion' },
});
app.use('/auth/login', loginLimiter);

// ── Routes ────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/auth/accounts', accountRoutes);
app.use('/auth/cascade', cascadeRoutes);
app.use('/auth/csv', csvRoutes);

const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
// Route par défaut pour tester facilement dans le navigateur du téléphone
app.get('/', (_, res) => res.send('Serveur Auth EduNotify opérationnel !'));

// Health check
app.get('/health', (_, res) => res.json({
  status: 'ok',
  service: 'auth-service',
  timestamp: new Date().toISOString(),
}));

// ── Error handler ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Auth Service Error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Erreur interne du serveur',
  });
});

// ── Démarrage ─────────────────────────────────────────────────────
const start = async () => {
  try {
    await connectDB();
    console.log('[Auth Service] Email service (Brevo API) prêt');

    // MODIFICATION ICI : On ajoute '0.0.0.0'
    // Cela permet au serveur d'écouter sur TOUTES les interfaces réseau (Wi-Fi, Ethernet, etc.)
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`--------------------------------------------------`);
      console.log(`[Auth Service] Démarré avec succès !`);
      console.log(`[Auth Service] Port      : ${PORT}`);
      console.log(`[Auth Service] Interface : 0.0.0.0 (Accepté via Wi-Fi)`);
      console.log(`--------------------------------------------------`);
    });
  } catch (err) {
    console.error('[Auth Service] Échec démarrage:', err);
    process.exit(1);
  }
};

start();