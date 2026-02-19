# Configuration

## Environment Variables

### Required

- `ASSEMBLYAI_API_KEY`
  - Required for all transcription paths that use AssemblyAI.

- `ANTHROPIC_API_KEY`
  - Required for summaries.
  - Also used for non-English transcript translation fallback.

### Recommended for YouTube Transcript Pipeline

- `SUPADATA_API_KEY`
  - Required for `POST /api/youtube/transcript` non-live flow.

### Required for YouTube/Meta Video Downloads

- `DECODO_PROXY_USER`
- `DECODO_PROXY_PASS`

Used by yt-dlp commands behind the Decodo proxy gateway.

### Optional

- `PORT` (default `3000`)
- `ADMIN_PASSWORD` (default `2323`; should be changed)
- `DATABASE_URL` (enables PostgreSQL persistence)
- `NODE_ENV` (affects cookie security and DB SSL mode)

### Queue Limits (optional)

Set in env or defaults from `lib/queue.js`:

- `MAX_GLOBAL_CONCURRENT` (default `10`)
- `MAX_USER_CONCURRENT` (default `3`)
- `MAX_USER_QUEUE` (default `10`)

## Hardcoded Runtime Constants

### In `lib/queue.js`

- `JOB_RETENTION_MS` = 10 minutes
- `UPLOAD_CLEANUP_INTERVAL_MS` = 5 minutes
- `UPLOAD_MAX_AGE_MS` = 30 minutes

### In `server.js`

- Express JSON/body limits: `50mb`
- Multer file limit: `1GB`
- Live transcription polling/timeout and download TTL are in-memory constants.
- Node server timeouts:
  - `server.timeout = 600000`
  - `server.keepAliveTimeout = 600000`
  - `server.headersTimeout = 600000`

## Client-Side Settings (`localStorage`)

- `vt_settings`
  - `timestamps` (boolean)
  - `livestreamDuration` (seconds, clamped 30-600)

- `vt_history`
  - last 20 sessions

- `vt_saved_prompts`
  - named prompt collection

## External Tooling Requirements

Server runtime expects these binaries available in PATH:

- `ffmpeg`
- `yt-dlp`
- dependencies used by yt-dlp (Python runtime in Docker image)
