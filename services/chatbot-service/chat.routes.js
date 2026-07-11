// services/chatbot-service/chat.routes.js
const express = require('express');
const router  = express.Router();
const { handleChatMessage, getChatHistory } = require('./chat.controller');

// POST http://IP:8085/api/chat
router.post('/', handleChatMessage);

// GET  http://IP:8085/api/chat/history
router.get('/history', getChatHistory);

module.exports = router;