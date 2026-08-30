// services/billing-service/src/middleware/auth.js
// Authentification JWT unifiée — voir shared/middleware/authJwt.js
// Le Bearer token est OBLIGATOIRE ; les headers x-user-* du client sont ignorés.

const { authenticate, requireRole } = require('../../../../shared/middleware/authJwt');

module.exports = { auth: authenticate, requireRole };