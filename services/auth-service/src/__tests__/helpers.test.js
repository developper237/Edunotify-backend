// services/auth-service/src/__tests__/helpers.test.js
// ─────────────────────────────────────────────────────
// Tests UNITAIRES — aucune base de données, aucun réseau
// ─────────────────────────────────────────────────────

process.env.JWT_SECRET         = 'test_secret_unitaire_32chars_ok!!';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_32chars_ok!!';
process.env.JWT_EXPIRES_IN     = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

const jwt = require('jsonwebtoken');
const {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  generateTempPassword,
  generateOTP,
  serializeUser,
} = require('../utils/helpers');

// ══════════════════════════════════════════════════════
// hashPassword / verifyPassword
// ══════════════════════════════════════════════════════
describe('hashPassword & verifyPassword', () => {
  test('hash produit une chaîne différente du mot de passe original', async () => {
    const hash = await hashPassword('MonMotDePasse123!');
    expect(hash).not.toBe('MonMotDePasse123!');
    expect(hash).toMatch(/^\$2[aby]\$/); // format bcrypt
  });

  test('verifyPassword retourne true pour le bon mot de passe', async () => {
    const hash = await hashPassword('MonMotDePasse123!');
    const ok   = await verifyPassword('MonMotDePasse123!', hash);
    expect(ok).toBe(true);
  });

  test('verifyPassword retourne false pour un mauvais mot de passe', async () => {
    const hash = await hashPassword('MonMotDePasse123!');
    const ok   = await verifyPassword('MauvaisMotDePasse', hash);
    expect(ok).toBe(false);
  });

  test('deux hashes du même mot de passe sont différents (sel aléatoire)', async () => {
    const hash1 = await hashPassword('MotDePasse');
    const hash2 = await hashPassword('MotDePasse');
    expect(hash1).not.toBe(hash2);
  });
});

// ══════════════════════════════════════════════════════
// generateAccessToken
// ══════════════════════════════════════════════════════
describe('generateAccessToken', () => {
  const fakeUser = {
    id:               'user-123',
    email:            'test@edunotify.cm',
    role:             'etudiant',
    etablissementId:  'etab-456',
    departementId:    null,
    classeEtudiantId: 'classe-789',
    classeDelegueId:  null,
  };

  test('génère un token JWT valide', () => {
    const token = generateAccessToken(fakeUser);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // header.payload.signature
  });

  test('le payload contient les bons champs', () => {
    const token   = generateAccessToken(fakeUser);
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    expect(payload.id).toBe('user-123');
    expect(payload.email).toBe('test@edunotify.cm');
    expect(payload.role).toBe('etudiant');
    expect(payload.etablissementId).toBe('etab-456');
    expect(payload.classeId).toBe('classe-789');
  });

  test('utilise classeEtudiantId en priorité sur classeDelegueId', () => {
    const userDelegue = {
      ...fakeUser,
      classeEtudiantId: null,
      classeDelegueId:  'delegueCLasse-111',
    };
    const token   = generateAccessToken(userDelegue);
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    expect(payload.classeId).toBe('delegueCLasse-111');
  });

  test('le token expire dans ~15 minutes', () => {
    const before = Math.floor(Date.now() / 1000);
    const token   = generateAccessToken(fakeUser);
    const payload = jwt.decode(token);
    const diff    = payload.exp - before;
    expect(diff).toBeGreaterThan(800);   // > 13 min
    expect(diff).toBeLessThan(920);      // < 16 min
  });

  test('un token signé avec un mauvais secret est rejeté', () => {
    const token = generateAccessToken(fakeUser);
    expect(() => jwt.verify(token, 'mauvais_secret')).toThrow();
  });
});

// ══════════════════════════════════════════════════════
// generateRefreshToken
// ══════════════════════════════════════════════════════
describe('generateRefreshToken', () => {
  test('génère un token JWT valide', () => {
    const token = generateRefreshToken('user-123');
    expect(token.split('.')).toHaveLength(3);
  });

  test('le payload contient uniquement l\'id', () => {
    const token   = generateRefreshToken('user-123');
    const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    expect(payload.id).toBe('user-123');
    expect(payload.email).toBeUndefined();
    expect(payload.role).toBeUndefined();
  });

  test('expire dans ~7 jours', () => {
    const before = Math.floor(Date.now() / 1000);
    const token   = generateRefreshToken('user-123');
    const payload = jwt.decode(token);
    const diff    = payload.exp - before;
    const sevenDays = 7 * 24 * 3600;
    expect(diff).toBeGreaterThan(sevenDays - 60);
    expect(diff).toBeLessThan(sevenDays + 60);
  });
});

// ══════════════════════════════════════════════════════
// generateTempPassword
// ══════════════════════════════════════════════════════
describe('generateTempPassword', () => {
  test('commence par "Edu@"', () => {
    expect(generateTempPassword('21G001')).toMatch(/^Edu@/);
  });

  test('inclut l\'identifiant passé en paramètre', () => {
    expect(generateTempPassword('21G001')).toBe('Edu@21G001');
    expect(generateTempPassword('serge')).toBe('Edu@serge');
  });
});

// ══════════════════════════════════════════════════════
// generateOTP
// ══════════════════════════════════════════════════════
describe('generateOTP', () => {
  test('retourne une chaîne de 6 chiffres', () => {
    const otp = generateOTP();
    expect(otp).toMatch(/^\d{6}$/);
  });

  test('est compris entre 100000 et 999999', () => {
    const otp = parseInt(generateOTP(), 10);
    expect(otp).toBeGreaterThanOrEqual(100000);
    expect(otp).toBeLessThanOrEqual(999999);
  });

  test('génère des valeurs différentes (aléatoire)', () => {
    const otps = new Set(Array.from({ length: 20 }, () => generateOTP()));
    expect(otps.size).toBeGreaterThan(1);
  });
});

// ══════════════════════════════════════════════════════
// serializeUser
// ══════════════════════════════════════════════════════
describe('serializeUser', () => {
  const fakeUser = {
    id:               'u1',
    nom:              'KUISSU',
    prenom:           'Rachel',
    email:            'rachel@test.cm',
    role:             'etudiant',
    statut:           'actif',
    matricule:        '21G0002',
    etablissementId:  'etab-1',
    departementId:    null,
    classeEtudiantId: 'classe-1',
    classeDelegueId:  null,
    fcmToken:         null,
    biometrieActivee: false,
    etablissement:    { nom: 'IUC de Logbessou' },
    departementChef:  null,
    classeEtudiant:   { codeGenere: 'D3-GL-L1-FA' },
    classeDelegue:    null,
  };

  test('retourne les champs attendus', () => {
    const result = serializeUser(fakeUser);
    expect(result.id).toBe('u1');
    expect(result.nom).toBe('KUISSU');
    expect(result.email).toBe('rachel@test.cm');
    expect(result.role).toBe('etudiant');
    expect(result.classeId).toBe('classe-1');
    expect(result.etablissementNom).toBe('IUC de Logbessou');
    expect(result.salleCode).toBe('D3-GL-L1-FA');
  });

  test('n\'expose pas le mot de passe', () => {
    const userAvecMdp = { ...fakeUser, password: 'hash_secret' };
    const result      = serializeUser(userAvecMdp);
    expect(result.password).toBeUndefined();
  });
});
