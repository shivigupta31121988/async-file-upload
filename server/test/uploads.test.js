const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { Readable, Writable } = require('node:stream');
const { createUploadsRouter } = require('../src/routes/uploads');

function makeDependencies() {
  const storedFiles = new Map();
  const activityRecords = new Map();

  const bucket = {
    openUploadStream(filename, options) {
      const chunks = [];
      return new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.from(chunk));
          callback();
        },
        final(callback) {
          const data = Buffer.concat(chunks);
          storedFiles.set(options.id.toString(), {
            _id: options.id,
            filename,
            contentType: options.contentType,
            length: data.length,
            data
          });
          callback();
        }
      });
    },
    async delete(id) {
      if (!storedFiles.delete(id.toString())) throw new Error('Not found');
    },
    openDownloadStream(id) {
      const file = storedFiles.get(id.toString());
      if (!file) {
        const stream = new Readable({ read() {} });
        process.nextTick(() => stream.destroy(Object.assign(new Error('Not found'), { code: 'ENOENT' })));
        return stream;
      }
      return Readable.from(file.data);
    }
  };

  const activities = {
    async insertOne(record) {
      activityRecords.set(record.fileId.toString(), record);
    },
    find() {
      let limit = 50;
      const cursor = {
        sort() { return cursor; },
        limit(value) { limit = value; return cursor; },
        async toArray() {
          return [...activityRecords.values()]
            .sort((a, b) => b.uploadedAt - a.uploadedAt)
            .slice(0, limit);
        }
      };
      return cursor;
    },
    async findOne(query) {
      return activityRecords.get(query.fileId.toString()) || null;
    }
  };

  const db = {
    collection() {
      return {
        async findOne(query) {
          return storedFiles.get(query._id.toString()) || null;
        }
      };
    }
  };

  return { bucket, activities, db, storedFiles, activityRecords };
}

async function startTestServer(maxFileSizeBytes = 1024) {
  const dependencies = makeDependencies();
  const app = express();
  app.use('/api/uploads', createUploadsRouter({
    ...dependencies,
    bucketName: 'uploads',
    maxFileSizeBytes
  }));
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    ...dependencies,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

function multipartFile(bytes, filename = 'sample.TXT') {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'text/plain' }), filename);
  return form;
}

test('stores a file in GridFS, records activity, lists it, and streams it back', async (t) => {
  const app = await startTestServer();
  t.after(() => app.server.close());

  const content = Buffer.from('hello streamed file');
  const response = await fetch(`${app.baseUrl}/api/uploads`, {
    method: 'POST',
    headers: { 'x-uploader': 'Test User' },
    body: multipartFile(content)
  });
  assert.equal(response.status, 201);
  const record = await response.json();
  assert.equal(record.uploader, 'Test User');
  assert.equal(record.originalFilename, 'sample.TXT');
  assert.equal(record.extension, '.txt');
  assert.equal(record.bytes, content.length);
  assert.equal(typeof record.durationMs, 'number');
  assert.ok(record.uploadedAt);
  assert.equal(app.activityRecords.size, 1);

  const listResponse = await fetch(`${app.baseUrl}/api/uploads?limit=10`);
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].id, record.id);

  const downloadResponse = await fetch(`${app.baseUrl}${record.downloadUrl}`);
  assert.equal(downloadResponse.status, 200);
  assert.deepEqual(Buffer.from(await downloadResponse.arrayBuffer()), content);
});

test('rejects an oversized upload and does not leave a completed file or activity record', async (t) => {
  const app = await startTestServer(4);
  t.after(() => app.server.close());

  const response = await fetch(`${app.baseUrl}/api/uploads`, {
    method: 'POST',
    body: multipartFile(Buffer.from('12345'), 'too-big.bin')
  });
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /exceeds the configured limit/i);
  assert.equal(app.storedFiles.size, 0);
  assert.equal(app.activityRecords.size, 0);
});

