// gateway/src/index.js

const express       = require('express');
const helmet        = require('helmet');
const cors          = require('cors');
const morgan        = require('morgan');
const { createProxyMiddleware } = require('http-proxy-middleware');
const jwt           = require('jsonwebtoken');
const rateLimit     = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 8080;

// ── Middlewares ───────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(morgan('dev'));

// Rate limiting global
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
}));

// ── Middleware d'authentification ─────────────────────────────────
const authenticate = (req, res, next) => {
  // Routes publiques — pas besoin de token
  const publicRoutes = [
    '/auth/login',
    '/auth/refresh',
    '/health',
  ];

  if (publicRoutes.some(r => req.path.startsWith(r))) {
    return next();
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  try {
    const token   = header.split(' ')[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user      = payload;
    // Ajouter les infos user en headers pour les services downstream
    req.headers['x-user-id']    = payload.id;
    req.headers['x-user-role']  = payload.role;
    req.headers['x-etab-id']    = payload.etablissementId || '';
    req.headers['x-dept-id']    = payload.departementId   || '';
    req.headers['x-classe-id']  = payload.classeId        || '';
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expiré', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token invalide' });
  }
};

app.use(authenticate);

// ── Health check gateway ──────────────────────────────────────────
app.get('/health', (_, res) => res.json({
  status:    'ok',
  service:   'gateway',
  timestamp: new Date().toISOString(),
}));

// ── Proxy vers les services ───────────────────────────────────────
const proxyOptions = (target) => ({
  target,
  changeOrigin: true,
  on: {
    error: (err, req, res) => {
      console.error(`[Gateway] Proxy error → ${target}:`, err.message);
      res.status(503).json({ error: 'Service temporairement indisponible' });
    },
  },
});

// Auth Service → /auth/*
app.use('/auth', createProxyMiddleware(
  proxyOptions(process.env.AUTH_SERVICE_URL)
));

// User Service → /users/*
app.use('/users', createProxyMiddleware(
  proxyOptions(process.env.USER_SERVICE_URL)
));

// Notification Service → /notifications/*
app.use('/notifications', createProxyMiddleware(
  proxyOptions(process.env.NOTIFICATION_SERVICE_URL)
));

// Presence Service → /presence/*
app.use('/presence', createProxyMiddleware(
  proxyOptions(process.env.PRESENCE_SERVICE_URL)
));

// Academic Service → /academic/*
app.use('/academic', createProxyMiddleware(
  proxyOptions(process.env.ACADEMIC_SERVICE_URL)
));

// File Service → /files/*
app.use('/files', createProxyMiddleware(
  proxyOptions(process.env.FILE_SERVICE_URL)
));

// ── 404 ───────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.path} non trouvée` });
});

app.listen(PORT, () => {
  console.log(`[Gateway] Port ${PORT} — OK`);
});
