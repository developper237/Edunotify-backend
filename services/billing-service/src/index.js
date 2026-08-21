// services/billing-service/src/index.js

const path = require('path');
// .env local au service, puis .env racine du repo en repli (dev)
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const morgan  = require('morgan');

const { connectDB }    = require('./utils/db');
const billingRoutes    = require('./routes/billing.routes');
const libraryRoutes    = require('./routes/library.routes');
const examRoutes       = require('./routes/exam.routes');
const chatRoutes       = require('./routes/chat.routes');
const { semerPlans }   = require('./seed/plans');
const { verifierExpirations } = require('./controllers/billing.controller');

const app  = express();
const PORT = process.env.PORT || 3007;

// ── Middlewares ───────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────
app.use('/billing', billingRoutes);
app.use('/library', libraryRoutes);
app.use('/exam', examRoutes);
app.use('/chat', chatRoutes);

// Servir les fichiers uploadés (bibliothèque)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check
app.get('/health', (_, res) => res.json({
  status:    'ok',
  service:   'billing-service',
  timestamp: new Date().toISOString(),
}));

// ── Planificateur d'expiration (essai 14j / fin de période) ───────
const INTERVALLE_EXPIRATION_MS = 6 * 60 * 60 * 1000; // toutes les 6 heures

const start = async () => {
  await connectDB();
  await semerPlans();
  await verifierExpirations().catch((err) =>
    console.error('[Billing] Vérification initiale des expirations:', err.message));
  setInterval(() => verifierExpirations().catch(() => {}), INTERVALLE_EXPIRATION_MS);

  app.listen(PORT, () => {
    console.log(`--------------------------------------------------`);
    console.log(`[Billing Service] Démarré avec succès !`);
    console.log(`[Billing Service] Port : ${PORT}`);
    console.log(`--------------------------------------------------`);
  });
};

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
