const { MongoClient, GridFSBucket } = require('mongodb');

async function connectToDatabase({ uri, dbName, bucketName }) {
  const client = new MongoClient(uri, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 10_000
  });

  await client.connect();
  const db = dbName ? client.db(dbName) : client.db();
  const activities = db.collection('upload_activity');

  await Promise.all([
    activities.createIndex({ uploadedAt: -1 }),
    activities.createIndex({ fileId: 1 }, { unique: true })
  ]);

  return {
    client,
    db,
    activities,
    bucket: new GridFSBucket(db, { bucketName })
  };
}

module.exports = { connectToDatabase };
