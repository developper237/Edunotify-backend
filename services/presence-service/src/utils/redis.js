// services/presence-service/src/utils/redis.js
const Redis = require('ioredis');

let redis;

const connectRedis = async () => {
  const Redis = require("ioredis");

let redis;

const connectRedis = async () => {
  if (redis) return redis;

  redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy(times) {
      console.log(`[Redis] Nouvelle tentative ${times}`);
      return Math.min(times * 200, 5000);
    },
  });

  redis.on("connect", () => {
    console.log("[Presence Service] Redis connecté");
  });

  redis.on("ready", () => {
    console.log("[Presence Service] Redis prêt");
  });

  redis.on("error", (err) => {
    console.error("[Presence Service] Redis erreur :", err.message);
  });

  redis.on("close", () => {
    console.log("[Presence Service] Redis fermé");
  });

  redis.on("reconnecting", () => {
    console.log("[Presence Service] Reconnexion Redis...");
  });

  await redis.connect();

  return redis;
};
  redis.on('connect', () =>
    console.log('[Presence Service] Redis connecté')
  );
  redis.on('error', (err) =>
    console.error('[Presence Service] Redis erreur:', err)
  );
  return redis;
};

const getRedis = () => {
  if (!redis) throw new Error('Redis non initialisé');
  return redis;
};

// ── Clés Redis ────────────────────────────────────────────────────
// session:CODE       → { sessionId, classeId, delegueId, matiere, ... }
// session:active:CLASSE_ID → CODE  (session active pour une classe)

const SESSION_PREFIX  = 'session:';
const ACTIVE_PREFIX   = 'session:active:';

const RedisService = {
  // Créer une session OTP
  setSession: async (code, data, ttlSeconds) => {
    const r = getRedis();
    await r.setex(
      `${SESSION_PREFIX}${code}`,
      ttlSeconds,
      JSON.stringify(data)
    );
    // Marquer la classe comme ayant une session active
    await r.setex(
      `${ACTIVE_PREFIX}${data.classeId}`,
      ttlSeconds,
      code
    );
  },

  // Récupérer une session par code
  getSession: async (code) => {
    const r    = getRedis();
    const data = await r.get(`${SESSION_PREFIX}${code}`);
    return data ? JSON.parse(data) : null;
  },

  // TTL restant d'un code
  getTTL: async (code) => {
    const r = getRedis();
    return r.ttl(`${SESSION_PREFIX}${code}`);
  },

  // Supprimer une session (fermeture manuelle)
  deleteSession: async (code, classeId) => {
    const r = getRedis();
    await r.del(`${SESSION_PREFIX}${code}`);
    await r.del(`${ACTIVE_PREFIX}${classeId}`);
  },

  // Vérifier si une classe a une session active
  getActiveSession: async (classeId) => {
    const r    = getRedis();
    const code = await r.get(`${ACTIVE_PREFIX}${classeId}`);
    if (!code) return null;
    const data = await r.get(`${SESSION_PREFIX}${code}`);
    return data ? { code, ...JSON.parse(data) } : null;
  },
};

module.exports = { connectRedis, getRedis, RedisService };
