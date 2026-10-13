const DEFAULT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 * 1024;

function readPositiveInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return parsed;
}

function loadConfig() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required. Copy server/.env.example to server/.env and set it.');
  }

  return {
    mongoUri,
    mongoDb: process.env.MONGODB_DB?.trim() || undefined,
    port: readPositiveInteger(process.env.PORT, 3000, 'PORT'),
    clientOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:4200')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    gridFsBucket: process.env.GRIDFS_BUCKET?.trim() || 'uploads',
    maxFileSizeBytes: readPositiveInteger(
      process.env.MAX_FILE_SIZE_BYTES,
      DEFAULT_MAX_FILE_SIZE_BYTES,
      'MAX_FILE_SIZE_BYTES'
    )
  };
}

module.exports = { loadConfig };
