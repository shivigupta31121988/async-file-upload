const { Router } = require('express');
const Busboy = require('busboy');
const { ObjectId } = require('mongodb');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

function cleanFilename(value) {
  const normalized = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\\/g, '/');
  return path.basename(normalized).slice(0, 500) || 'upload.bin';
}

function cleanUploader(value) {
  const normalized = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 120);
  return normalized || 'Unknown';
}

function publicRecord(record) {
  const id = record.fileId.toString();
  return {
    id,
    originalFilename: record.originalFilename,
    extension: record.extension,
    mimeType: record.mimeType,
    bytes: record.bytes,
    uploader: record.uploader,
    startedAt: record.startedAt,
    uploadedAt: record.uploadedAt,
    durationMs: record.durationMs,
    downloadUrl: `/api/uploads/${id}/download`
  };
}

function isValidId(value) {
  return typeof value === 'string' && ObjectId.isValid(value) && String(new ObjectId(value)) === value;
}

function createUploadsRouter({ db, activities, bucket, bucketName, maxFileSizeBytes }) {
  const router = Router();
  const files = db.collection(`${bucketName}.files`);

  router.post('/', (req, res, next) => {
    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: {
          fileSize: maxFileSizeBytes,
          files: 2,
          fields: 8,
          fieldSize: 8 * 1024
        }
      });
    } catch (_error) {
      return res.status(400).json({ error: 'Expected a valid multipart/form-data request.' });
    }

    const fileId = new ObjectId();
    const startedAt = new Date();
    const startClock = process.hrtime.bigint();
    const uploader = cleanUploader(req.get('x-uploader'));
    let fileSeen = false;
    let tooManyFiles = false;
    let unexpectedFileField = false;
    let sizeExceeded = false;
    let clientAborted = false;
    let uploadStream;
    let uploadPromise;
    let fileMetadata;
    let bytesReceived = 0;
    let parserFailed = false;

    const parserDone = new Promise((resolve, reject) => {
      parser.once('finish', resolve);
      parser.once('error', (error) => {
        parserFailed = true;
        reject(error);
      });
    });

    parser.on('file', (fieldName, file, info) => {
      if (fieldName !== 'file') {
        unexpectedFileField = true;
        file.resume();
        return;
      }
      if (fileSeen) {
        tooManyFiles = true;
        file.resume();
        return;
      }

      fileSeen = true;
      const originalFilename = cleanFilename(info.filename);
      const extension = path.extname(originalFilename).slice(0, 32).toLowerCase();
      const mimeType = String(info.mimeType || 'application/octet-stream').slice(0, 255);
      fileMetadata = { originalFilename, extension, mimeType };

      uploadStream = bucket.openUploadStream(originalFilename, {
        id: fileId,
        contentType: mimeType,
        metadata: {
          uploader,
          originalFilename,
          extension,
          mimeType,
          startedAt
        }
      });

      file.on('data', (chunk) => {
        bytesReceived += chunk.length;
      });
      file.once('limit', () => {
        sizeExceeded = true;
      });

      // pipeline streams the request directly into GridFS; file bytes are not buffered in RAM.
      uploadPromise = pipeline(file, uploadStream);
      // Attach a handler immediately so an early storage error cannot become an unhandled rejection
      // while the multipart parser is still consuming the request.
      uploadPromise.catch(() => {});
    });

    parser.on('filesLimit', () => {
      tooManyFiles = true;
    });

    req.once('aborted', () => {
      clientAborted = true;
      if (uploadStream && !uploadStream.destroyed) {
        uploadStream.destroy(new Error('Client disconnected during upload.'));
      }
      if (!parser.destroyed) parser.destroy(new Error('Client disconnected during upload.'));
    });

    req.pipe(parser);

    const cleanupPartialUpload = async () => {
      if (uploadStream && !uploadStream.writableFinished) {
        // GridFS abort removes any chunks that were written before the files document was finalized.
        try {
          await uploadStream.abort();
        } catch (_error) {
          // A finished/errored stream may no longer be abortable; delete below handles completed files.
        }
        if (!uploadStream.destroyed) uploadStream.destroy();
      }
      try {
        await bucket.delete(fileId);
      } catch (_error) {
        // GridFS may not have created a files document yet. The original failure is more useful.
      }
    };

    (async () => {
      try {
        await parserDone;
        if (clientAborted) return;

        if (!fileSeen) {
          const message = tooManyFiles ? 'Only one file may be uploaded per request.' : 'A file field named "file" is required.';
          return res.status(400).json({ error: message });
        }

        if (tooManyFiles || unexpectedFileField) {
          if (uploadPromise) await uploadPromise.catch(() => {});
          await cleanupPartialUpload();
          return res.status(400).json({ error: 'Send exactly one file using the multipart field name "file".' });
        }

        await uploadPromise;
        if (clientAborted) return;

        if (sizeExceeded) {
          await cleanupPartialUpload();
          return res.status(413).json({
            error: `File exceeds the configured limit of ${maxFileSizeBytes} bytes.`
          });
        }

        const uploadedAt = new Date();
        const durationMs = Math.max(0, Math.round(Number(process.hrtime.bigint() - startClock) / 1e6));
        const record = {
          fileId,
          originalFilename: fileMetadata.originalFilename,
          extension: fileMetadata.extension,
          mimeType: fileMetadata.mimeType,
          bytes: bytesReceived,
          uploader,
          startedAt,
          uploadedAt,
          durationMs
        };

        try {
          await activities.insertOne(record);
        } catch (error) {
          await cleanupPartialUpload();
          throw error;
        }

        return res.status(201).json(publicRecord(record));
      } catch (error) {
        if (uploadPromise) await uploadPromise.catch(() => {});
        await cleanupPartialUpload();
        if (clientAborted || res.destroyed) return;
        if (sizeExceeded) {
          return res.status(413).json({
            error: `File exceeds the configured limit of ${maxFileSizeBytes} bytes.`
          });
        }
        if (parserFailed || error?.message?.includes('Multipart:')) {
          return res.status(400).json({ error: 'Malformed multipart/form-data request.' });
        }
        return next(error);
      }
    })();
  });

  router.get('/', async (req, res, next) => {
    try {
      const parsedLimit = Number.parseInt(String(req.query.limit || '50'), 10);
      const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 100)) : 50;
      const records = await activities.find({}).sort({ uploadedAt: -1 }).limit(limit).toArray();
      return res.json({ items: records.map(publicRecord) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id/download', async (req, res, next) => {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid upload id.' });
    try {
      const fileId = new ObjectId(req.params.id);
      const file = await files.findOne({ _id: fileId });
      if (!file) return res.status(404).json({ error: 'Upload not found.' });

      const filename = cleanFilename(file.filename);
      const encodedFilename = encodeURIComponent(filename).replace(/[!'()*]/g, (char) =>
        `%${char.charCodeAt(0).toString(16).toUpperCase()}`
      );
      res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
      res.setHeader('Content-Length', String(file.length));
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);

      const downloadStream = bucket.openDownloadStream(fileId);
      downloadStream.once('error', (error) => {
        if (res.headersSent) return res.destroy(error);
        if (error.code === 'ENOENT') return res.status(404).json({ error: 'Upload not found.' });
        return next(error);
      });
      return downloadStream.pipe(res);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id', async (req, res, next) => {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid upload id.' });
    try {
      const record = await activities.findOne({ fileId: new ObjectId(req.params.id) });
      if (!record) return res.status(404).json({ error: 'Upload not found.' });
      return res.json(publicRecord(record));
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createUploadsRouter };
