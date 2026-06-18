// services/auth-service/src/__tests__/auth.integration.test.js
// Tests d'INTÉGRATION — routes HTTP avec base de données réelle

require('dotenv').config({
  path: require('path').resolve(__dirname, '../../../../../.env'),
});

process.env.JWT_SECRET         = process.env.JWT_SECRET || 'test_secret_unitaire_32chars_ok!!';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_refresh_secret_32chars_ok!!';

const request = require('supertest');
const { PrismaClient } = require('../../../../node_modules/.prisma/client');
const { hashPassword }  = require('../utils/helpers');
const prisma = new PrismaClient();

const express       = require('express');
const helmet        = require('helmet');
const cors          = require('cors');
const authRoutes    = require('../routes/auth.routes');
const cascadeRoutes = require('../routes/cascade.routes');

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use('/auth',         authRoutes);
app.use('/auth/cascade', cascadeRoutes);

// ── Données de test ────────────────────────────────────────────
let testUserId;
// Token partagé entre tous les describe — obtenu une seule fois
let sharedAccessToken;
let sharedRefreshToken;

const TEST_EMAIL    = `jest_integ_${Date.now()}@edunotify.test`;
const TEST_PASSWORD = 'TestPassword123!';

// ══════════════════════════════════════════════════════════════
// SETUP GLOBAL
// ══════════════════════════════════════════════════════════════
beforeAll(async () => {
  const etab = await prisma.etablissement.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!etab) throw new Error('Aucun établissement en base.');

  const hashedPwd = await hashPassword(TEST_PASSWORD);
  const user = await prisma.user.create({
    data: {
      email:           TEST_EMAIL,
      passwordHash:    hashedPwd,
      nom:             'TEST',
      prenom:          'Jest',
      role:            'admin',
      statut:          'actif',
      etablissementId: etab.id,
    },
  });
  testUserId = user.id;

  // Login une seule fois — tokens partagés dans toute la suite
  const loginRes = await request(app)
    .post('/auth/login')
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

  sharedAccessToken  = loginRes.body.accessToken;
  sharedRefreshToken = loginRes.body.refreshToken;
});

afterAll(async () => {
  if (!testUserId) { await prisma.$disconnect(); return; }
  await prisma.notificationDestinataire.deleteMany({ where: { userId: testUserId } });
  await prisma.notification.deleteMany({ where: { expediteurId: testUserId } });
  await prisma.voteSondage.deleteMany({ where: { userId: testUserId } });
  await prisma.refreshToken.deleteMany({ where: { userId: testUserId } });
  await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
  await prisma.$disconnect();
});

// ══════════════════════════════════════════════════════════════
// POST /auth/login
// ══════════════════════════════════════════════════════════════
describe('POST /auth/login', () => {
  test('200 — connexion réussie retourne accessToken + refreshToken', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.user.email).toBe(TEST_EMAIL);
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.user.password).toBeUndefined();
  });

  test('401 — mauvais mot de passe', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: 'MauvaisMotDePasse!' });
    expect(res.status).toBe(401);
  });

  test('401 — email inexistant', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'inexistant_jest@test.cm', password: TEST_PASSWORD });
    expect(res.status).toBe(401);
  });

  test('400 — body vide', async () => {
    const res = await request(app).post('/auth/login').send({});
    expect(res.status).toBe(400);
  });

  test('400 — email invalide (format incorrect)', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'pas-un-email', password: TEST_PASSWORD });
    expect(res.status).toBe(400);
  });

  test('401/403 — compte désactivé', async () => {
    await prisma.user.update({
      where: { id: testUserId },
      data:  { statut: 'inactif' },
    });

    const res = await request(app)
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    // Certains backends retournent 401, d'autres 403 — les deux sont corrects
    expect([401, 403]).toContain(res.status);

    await prisma.user.update({
      where: { id: testUserId },
      data:  { statut: 'actif' },
    });
  });
});

// ══════════════════════════════════════════════════════════════
// POST /auth/refresh
// ══════════════════════════════════════════════════════════════
describe('POST /auth/refresh', () => {
  test('200 — refresh token valide retourne un nouvel access token', async () => {
    // Login frais pour ce test — évite que le token soit consommé ailleurs
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    const freshRefreshToken = loginRes.body.refreshToken;

    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: freshRefreshToken });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
  });

  test('401 — refresh token invalide (chaîne aléatoire)', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: 'token_bidon_12345' });
    expect(res.status).toBe(401);
  });

  test('400/401 — body sans refreshToken', async () => {
    const res = await request(app).post('/auth/refresh').send({});
    expect([400, 401]).toContain(res.status);
  });
});

// ══════════════════════════════════════════════════════════════
// GET /auth/me
// ══════════════════════════════════════════════════════════════
describe('GET /auth/me', () => {
  test('200 — retourne le profil avec un token valide', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${sharedAccessToken}`);

    expect(res.status).toBe(200);
    const email = res.body.user?.email ?? res.body.email;
    expect(email).toBe(TEST_EMAIL);
  });

  test('401 — sans token', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  test('401 — token malformé', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', 'Bearer token_completement_faux');
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════
// POST /auth/logout
// ══════════════════════════════════════════════════════════════
describe('POST /auth/logout', () => {
  test('200/204 — logout révoque le refresh token', async () => {
    // Login frais dédié à ce test
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    const { accessToken, refreshToken } = loginRes.body;
    expect(accessToken).toBeDefined();
    expect(refreshToken).toBeDefined();

    // Logout
    const logoutRes = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken });

    expect([200, 204]).toContain(logoutRes.status);

    // Le refresh token révoqué ne doit plus fonctionner
    const refreshRes = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken });

    expect(refreshRes.status).toBe(401);
  });
});
