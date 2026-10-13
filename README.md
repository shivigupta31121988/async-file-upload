# Async File Vault

A small Angular + Node.js application for **streaming large files to MongoDB GridFS** while the person uploading continues to use the app. The API is independently runnable and can be called without the Angular UI.

> **Why GridFS?** MongoDB BSON documents have a 16 MB size limit. GridFS stores one logical file in chunk documents (the driver defaults to 255 KB chunks), so the full file is never placed in one MongoDB document and the Node API does not buffer the whole upload in memory.

## What is included

- **Angular client** — file picker and drag/drop, progress reporting, upload status that survives Angular route changes, an example request form, and an upload activity screen.
- **Node/Express API** — one-file multipart endpoint, streamed write to GridFS, download and history endpoints, CORS, and basic security headers.
- **MongoDB activity log** — uploader display name, original filename, extension, MIME type, byte count, upload start/completion timestamps, and elapsed upload time.
- **OpenAPI description** — `server/openapi.yaml`.
- **Optional local MongoDB** — `docker-compose.yml` for development only.

## Requirements

- Node.js **20.19+** (or a current Node 22+ release) and npm.
- MongoDB 6+ with a database/user that can read and write collections and create indexes. A replica set is **not** required; this sample does not use multi-document transactions.

## Run locally

Use two terminals from the project folder.

### 1. Configure and start the API

```bash
cd server
cp .env.example .env
```

Edit `server/.env` and set `MONGODB_URI` to the connection string you provide. If the URI does not include a database name, set `MONGODB_DB` too. Do not put the connection string in the Angular client or commit `.env`.

Optionally, instead of a managed MongoDB instance, start the included local development database from the project root:

```bash
docker compose up -d mongodb
```

Then in `server/.env`, use `MONGODB_URI=mongodb://127.0.0.1:27017/async_file_vault` and `MONGODB_DB=async_file_vault`.

Install and run the API:

```bash
cd server
npm install
npm run dev
```

The API listens on `http://localhost:3000`. Use `npm start` for a non-watch run. Run the API's streaming/metadata tests with `npm test` from `server/`.

### 2. Start the Angular app

In another terminal:

```bash
cd client
npm install
npm start
```

Open `http://localhost:4200`. The Angular development server proxies `/api` calls to `http://127.0.0.1:3000` (configured in `client/proxy.conf.json`). Build the frontend with `npm run build`.

The sample request form is an interactive front-end demonstration and is not persisted by the API. Add your own form endpoint if those business fields should be stored.

## Standalone API

The API is independent of Angular. Run `server` as above and use it from curl, another web app, or a service. `server/openapi.yaml` documents these routes.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/health` | API health |
| `POST` | `/api/uploads` | Stream one multipart file into GridFS and write its activity record |
| `GET` | `/api/uploads?limit=50` | List recent completed uploads (limit 1–100) |
| `GET` | `/api/uploads/{id}` | Get one upload's activity record |
| `GET` | `/api/uploads/{id}/download` | Stream the stored file back |

Example upload (curl sends the multipart boundary automatically):

```bash
curl -X POST \
  -H 'x-uploader: Alex Example' \
  -F 'file=@./large-archive.zip' \
  http://localhost:3000/api/uploads
```

Example history and download:

```bash
curl 'http://localhost:3000/api/uploads?limit=20'
curl -L 'http://localhost:3000/api/uploads/<returned-id>/download' -o downloaded-file.zip
```

The upload endpoint expects **exactly one** file field called `file`. Set `x-uploader` to the uploader's display name; if omitted, the API records `Unknown`.

## Storage and activity records

- File data: GridFS bucket configured by `GRIDFS_BUCKET` (default `uploads`), stored in MongoDB collections `uploads.files` and `uploads.chunks`.
- Activity: `upload_activity`, indexed by newest upload and file id.
- `durationMs` is measured by the API from request handling start until the file has finished streaming into GridFS. The activity record is written immediately after that. `startedAt` and `uploadedAt` are server timestamps.
- The extension is recorded in lowercase (including the dot), e.g. `.zip`; extensionless files use an empty string.
- The default maximum file size is **5 GiB**. Adjust `MAX_FILE_SIZE_BYTES` to a positive finite value in `server/.env` for your environment. Keep the Node process, MongoDB deployment, network/proxy timeouts, and any reverse-proxy body-size settings aligned with that limit.

## How background behavior works

The Angular upload is an HTTP request with progress events. A root-provided `UploadService` owns the request, so route navigation does not unsubscribe it; the small upload tray remains visible across the upload, request form, and activity pages. On the server, Busboy and MongoDB GridFS are connected as a stream, not a `multer` memory buffer. This keeps the Node event loop responsive and avoids holding a whole large file in RAM.

The upload continues while navigating **inside the running single-page app**. A browser refresh, tab close, device sleep, or network loss will stop the current request; this example is not a resumable/chunk-retry upload queue. For resumability across interruptions, add a chunk/session protocol and persist upload-session state.

## Important production notes

- `x-uploader` is a user-supplied display name, **not proof of identity**. For trustworthy audit attribution, add authentication and populate the uploader from the verified server-side principal; do not trust the client header.
- Use HTTPS, a narrowly scoped MongoDB account, secrets management for the URI, request/auth rate limits, observability, and backups. Restrict `CLIENT_ORIGIN` to the real UI origin(s).
- The API streams the file body but uses a normal upload request/response: `POST /api/uploads` responds after GridFS storage and activity logging have completed. The UI is non-blocking and reports upload progress; it is not a separate background-job/202-accepted design.
- If the UI and API are deployed separately, configure a reverse proxy or set up the Angular production host so `/api` routes to the API. Do not expose MongoDB credentials in browser code.
- Files are downloadable by MongoDB ObjectId in this demo. Add authorization checks before using it for private files.

## Configuration reference

| Variable | Default | Description |
|---|---|---|
| `MONGODB_URI` | required | MongoDB connection string |
| `MONGODB_DB` | URI default DB | Database name override |
| `PORT` | `3000` | API listen port |
| `CLIENT_ORIGIN` | `http://localhost:4200` | Comma-separated allowed browser origin(s) |
| `GRIDFS_BUCKET` | `uploads` | GridFS bucket name |
| `MAX_FILE_SIZE_BYTES` | `5368709120` | Per-file limit (5 GiB) |
