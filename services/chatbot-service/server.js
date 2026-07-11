
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

const express    = require('express');
const cors       = require('cors');
const chatRoutes = require('./chat.routes');

const app  = express();
const PORT = process.env.CHATBOT_PORT || 8085;

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[Chatbot Service] ${req.method} ${req.originalUrl} — userId=${req.headers['x-user-id'] || 'none'}`);
  if (req.method === 'POST' && req.body) {
    console.log('[Chatbot Service] request body:', JSON.stringify(req.body));
  }
  next();
});

// Routes chatbot
app.use('/api/chat', chatRoutes);

// Health check
app.get('/health', (_, res) => res.json({
  status:    'ok',
  service:   'chatbot-service',
  timestamp: new Date().toISOString(),
}));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`--------------------------------------------------`);
  console.log(`[Chatbot Service] Démarré avec succès !`);
  console.log(`[Chatbot Service] Port : ${PORT}`);
  console.log(`--------------------------------------------------`);
});
