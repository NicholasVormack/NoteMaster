/**
 * NoteMaster API.
 *
 * Configuration comes from the environment. The previous version embedded a live
 * MongoDB Atlas connection string, password included, in this file.
 *
 *   cp server/.env.example server/.env   # then fill it in
 *   npm start                            # from server/
 */

require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');

const auth = require('./middleware/auth');

const app = express();

const API_PORT = process.env.PORT || 8080;
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'you_note';

if (!MONGODB_URI) {
  console.error(
    'MONGODB_URI is not set.\n' +
      'Copy server/.env.example to server/.env and fill in your connection string.'
  );
  process.exit(1);
}

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is not set. Copy server/.env.example to server/.env first.');
  process.exit(1);
}

app.use(express.json({ limit: '1mb' }));

// Health check sits outside the auth wall so a deploy or a load balancer can
// see whether the process is alive without credentials.
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptimeSeconds: Math.round(process.uptime()),
  });
});

// Every /api route except registration and login requires a valid token.
app.all('/api/*', auth);

app.use('/api/notes', require('./routes/notes'));
app.use('/api/auth', require('./routes/auth'));

app.use((req, res) => {
  res.status(404).json({ msg: `No route for ${req.method} ${req.path}` });
});

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  console.error('[api] unhandled error:', error.message);
  res.status(500).json({ msg: 'Something went wrong.' });
});

mongoose
  .connect(MONGODB_URI, {
    dbName: MONGODB_DB,
    useNewUrlParser: true,
    useCreateIndex: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log(`Connected to MongoDB (${MONGODB_DB}).`);
    const server = app.listen(API_PORT, () => {
      console.log(`NoteMaster API listening on port ${API_PORT}.`);
    });

    const shutdown = () => {
      server.close(() => mongoose.disconnect().then(() => process.exit(0)));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  })
  .catch((error) => {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  });
