const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const { connectDB } = require('./utils/db');
const libraryRoutes = require('./routes/library.routes');

const app = express();
const PORT = process.env.PORT || 3008;

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Servir les fichiers uploadés
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/library', libraryRoutes);

app.get('/health', (_, res) => res.json({
  status: 'ok',
  service: 'library-service',
  timestamp: new Date().toISOString(),
}));

const start = async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log('[Library Service] Démarré sur le port', PORT);
  });
};

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
