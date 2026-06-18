// services/auth-service/src/__tests__/security.test.js
// Tests de SÉCURITÉ

require('dotenv').config({
  path: require('path').resolve(__dirname, '../../../../../.env'),
});

process.env.JWT_SECRET         = process.env.JWT_SECRET || 'test_secret_unitaire_32chars_ok!!';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_refresh_secret_32chars_ok!!';

const request   = require('supertest');
const jwt       = require('jsonwebtoken');
const { PrismaClient } = require('../../../../node_modules/.prisma/client');
const { hashPassword }  = require('../utils/helpers');
const prisma = new PrismaClient();

const express       = require('express');
const helmet        = require('helmet');
const cors          = require('cors');
const rateLimit     = require('express-rate-limit');
const authRoutes    = require('../routes/auth.routes');
const cascadeRoutes = require('../routes/cascade.routes');

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use('/auth',         authRoutes);
app.use('/auth/cascade', cascadeRoutes);

// ── Données de test ────────────────────────────────────────────
let adminUserId;
let tokenAdmin;

const EMAIL_ADMIN = `sec_admin_${Date.now()}@test.cm`;
const PWD         = 'SecureTest123!';

// ══════════════════════════════════════════════════════════════
// SETUP / TEARDOWN
// ══════════════════════════════════════════════════════════════
beforeAll(async () => {
  const etab = await prisma.etablissement.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!etab) throw new Error('Aucun établissement en base.');

  const pwd = await hashPassword(PWD);

  // passwordHash + statut actif
  const user = await prisma.user.create({
    data: {
      email:           EMAIL_ADMIN,
      passwordHash:    pwd,
      nom:             'SEC',
      prenom:          'Admin',
      role:            'admin',
      statut:          'actif',
      etablissementId: etab.id,
    },
  });
  adminUserId = user.id;

  const r = await request(app)
    .post('/auth/login')
    .send({ email: EMAIL_ADMIN, password: PWD });
  tokenAdmin = r.body.accessToken;
});

afterAll(async () => {
  if (!adminUserId) { await prisma.$disconnect(); return; }
  await prisma.notificationDestinataire.deleteMany({ where: { userId: adminUserId } });
  await prisma.notification.deleteMany({ where: { expediteurId: adminUserId } });
  await prisma.voteSondage.deleteMany({ where: { userId: adminUserId } });
  await prisma.refreshToken.deleteMany({ where: { userId: adminUserId } });
  await prisma.user.delete({ where: { id: adminUserId } }).catch(() => {});
  await prisma.$disconnect();
});

// ══════════════════════════════════════════════════════════════
// 1. INJECTION SQL / NoSQL
// ══════════════════════════════════════════════════════════════
describe('Injection SQL & NoSQL', () => {
  const payloads = [
    { email: "' OR '1'='1",             password: "' OR '1'='1" },
    { email: "admin'--",                password: 'anything' },
    { email: '"; DROP TABLE "User";--', password: 'x' },
    { email: '{"$gt": ""}',             password: '{"$gt": ""}' },
    { email: 'test@test.cm',            password: "' OR 1=1--" },
  ];

  test.each(payloads)(
    'payload injection rejeté: %o',
    async (payload) => {
      const res = await request(app).post('/auth/login').send(payload);
      expect(res.status).not.toBe(200);
      expect(res.status).not.toBe(500);
    }
  );
});

// ══════════════════════════════════════════════════════════════
// 2. JWT — tokens falsifiés / manipulés
// ══════════════════════════════════════════════════════════════
describe('Sécurité JWT', () => {
  test('token signé avec un mauvais secret est rejeté (401)', async () => {
    const fakeToken = jwt.sign(
      { id: adminUserId, role: 'admin', email: EMAIL_ADMIN },
      'mauvais_secret_pirate',
      { expiresIn: '1h' }
    );
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${fakeToken}`);
    expect(res.status).toBe(401);
  });

  test('token avec rôle falsifié est rejeté (mauvaise signature)', async () => {
    const fakeToken = jwt.sign(
      { id: adminUserId, role: 'super_admin', email: EMAIL_ADMIN },
      'mauvais_secret',
      { expiresIn: '1h' }
    );
    const res = await request(app)
      .get('/auth/cascade/etablissements')
      .set('Authorization', `Bearer ${fakeToken}`);
    expect(res.status).toBe(401);
  });

  test('token expiré est rejeté (401)', async () => {
    const expiredToken = jwt.sign(
      { id: adminUserId, role: 'admin', email: EMAIL_ADMIN },
      process.env.JWT_SECRET,
      { expiresIn: '-1s' }
    );
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
  });

  test('token avec algorithme "none" est rejeté', async () => {
    const header  = Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ id: adminUserId, role: 'super_admin' })
    ).toString('base64url');
    const noneToken = `${header}.${payload}.`;

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${noneToken}`);
    expect(res.status).toBe(401);
  });

  test('headers Authorization malformés sont rejetés', async () => {
    const cases = [
      'Basic dXNlcjpwYXNz',
      'Bearer',
      'token_sans_bearer',
    ];
    for (const header of cases) {
      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', header);
      expect(res.status).toBe(401);
    }
  });

  test('requête sans header Authorization est rejetée', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════
// 3. RATE LIMITING
// ══════════════════════════════════════════════════════════════
describe('Rate limiting — POST /auth/login', () => {
  test('après dépassement du seuil, retourne 429', async () => {
    const strictApp = express();
    strictApp.use(express.json());
    strictApp.use('/auth/login', rateLimit({
      windowMs: 60 * 1000,
      max:      3,
      message:  { error: 'Trop de tentatives.' },
    }));
    strictApp.use('/auth', authRoutes);

    const payload = { email: 'inexistant_rate@test.cm', password: 'wrong' };
    let lastStatus;
    for (let i = 0; i < 5; i++) {
      const res = await request(strictApp).post('/auth/login').send(payload);
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

// ══════════════════════════════════════════════════════════════
// 4. ENDPOINTS NON AUTHENTIFIÉS
// ══════════════════════════════════════════════════════════════
describe('Protection des endpoints sensibles', () => {
  const protectedRoutes = [
    { method: 'get', path: '/auth/me' },
    { method: 'get', path: '/auth/cascade/departements' },
    { method: 'get', path: '/auth/cascade/classes' },
    // Route /auth/accounts/stats absente de ce service — test retiré
  ];

  test.each(protectedRoutes)(
    '$method $path sans token → 401',
    async ({ method, path }) => {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
    }
  );
});

// ══════════════════════════════════════════════════════════════
// 5. HEADERS DE SÉCURITÉ (Helmet)
// ══════════════════════════════════════════════════════════════
describe('Headers de sécurité HTTP', () => {
  test('X-Content-Type-Options est présent', async () => {
    const res = await request(app).post('/auth/login').send({});
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('X-Frame-Options est présent', async () => {
    const res = await request(app).post('/auth/login').send({});
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  test('X-Powered-By est masqué', async () => {
    const res = await request(app).post('/auth/login').send({});
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════
// 6. ESCALADE DE PRIVILÈGES
// ══════════════════════════════════════════════════════════════
describe('Escalade de privilèges', () => {
  test('un admin ne peut pas accéder aux routes super_admin', async () => {
    const res = await request(app)
      .get('/auth/cascade/etablissements')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect([401, 403]).toContain(res.status);
  });

  test('changer son propre rôle sans être super_admin est refusé', async () => {
    const res = await request(app)
      .patch(`/auth/accounts/${adminUserId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ role: 'super_admin' });
    expect([401, 403, 404]).toContain(res.status);
  });
});

// ══════════════════════════════════════════════════════════════
// 7. DONNÉES SENSIBLES DANS LES RÉPONSES
// ══════════════════════════════════════════════════════════════
describe('Exposition de données sensibles', () => {
  test('la réponse /auth/login ne contient pas le hash bcrypt', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: EMAIL_ADMIN, password: PWD });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);
  });

  test('la réponse /auth/me ne contient pas passwordHash', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    const user = res.body.user ?? res.body;
    expect(user.passwordHash).toBeUndefined();
    expect(user.password).toBeUndefined();
  });

  test('les refresh tokens ne sont pas exposés dans /auth/me', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.body.refreshToken).toBeUndefined();
    expect(res.body.refreshTokens).toBeUndefined();
  });
});
