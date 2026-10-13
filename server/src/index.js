const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const { loadConfig } = require('./config');
const { connectToDatabase } = require('./db');
const { createUploadsRouter } = require('./routes/uploads');

async function main() {
  const config = loadConfig();
  const { client, db, activities, bucket } = await connectToDatabase({
    uri: config.mongoUri,
    dbName: config.mongoDb,
    bucketName: config.gridFsBucket
  });

  const app = express();
  const allowedOrigins = new Set(config.clientOrigins);

  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({
    origin(origin, callback) {
      // Requests without an Origin header include curl and other server-side API clients.
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-uploader'],
    exposedHeaders: ['Content-Disposition']
  }));
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', storage: 'mongodb-gridfs' });
  });
  app.use('/api/uploads', createUploadsRouter({
    db,
    activities,
    bucket,
    bucketName: config.gridFsBucket,
    maxFileSizeBytes: config.maxFileSizeBytes
  }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));

  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    console.error(error);
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    const message = status >= 500 ? 'The server could not complete the request.' : error.message;
    return res.status(status).json({ error: message });
  });

  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`File Vault API listening on http://0.0.0.0:${config.port}`);
    console.log(`MongoDB database: ${db.databaseName}; GridFS bucket: ${config.gridFsBucket}`);
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received; closing API and MongoDB connection...`);
    server.close(async () => {
      await client.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('Unable to start the File Vault API:', error.message);
  process.exit(1);
});
