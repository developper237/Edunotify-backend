// services/chatbot-service/chat.routes.js
const express = require('express');
const router  = express.Router();
const { handleChatMessage, getChatHistory } = require('./chat.controller');
const { authenticate: auth } = require('./authJwt');

// ── Toutes les routes chatbot exigent un utilisateur authentifié ──
router.use(auth);

// POST http://IP:8085/api/chat
router.post('/', handleChatMessage);

// GET  http://IP:8085/api/chat/history
router.get('/history', getChatHistory);

module.exports = router;