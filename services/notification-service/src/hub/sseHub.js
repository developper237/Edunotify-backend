// hub/sseHub.js
// Hub SSE en mémoire pour pousser les nouvelles notifications en temps réel.
// Une seule instance de service Render = singleton fiable. Si un jour on scale
// à plusieurs instances, il faudra un channel Redis (Redis pub/sub), mais pour
// l'instant ce singleton couvre la charge sans ajout d'infra.
const { EventEmitter } = require('events');

class SseHub extends EventEmitter {
  constructor() {
    super();
    // userId -> Set<Réponse HTTP SSE>
    this._clients = new Map();
    this.setMaxListeners(10000);
  }

  // Ajoute un client (réponse HTTP) pour un utilisateur donné.
  subscribe(userId, res) {
    if (!this._clients.has(userId)) this._clients.set(userId, new Set());
    this._clients.get(userId).add(res);
  }

  // Retire un client.
  unsubscribe(userId, res) {
    const set = this._clients.get(userId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) this._clients.delete(userId);
  }

  // Nombre de connexions actives (utile pour logs/observabilité).
  get size() {
    let n = 0;
    for (const set of this._clients.values()) n += set.size;
    return n;
  }

  // Diffuse un événement à TOUS les utilisateurs connectés. `userId` null =
  // événement global (ex: 'platform').
  broadcast(event, data, userId = null) {
    const targets = userId != null && this._clients.has(userId)
      ? [[userId, this._clients.get(userId)]]
      : Array.from(this._clients.entries());
    for (const [, set] of targets) {
      for (const res of set) {
        try {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        } catch (_) { /* client déconnecté, nettoyé plus tard */ }
      }
    }
  }
}

module.exports = new SseHub();