# API Reference

Base URL:

- Local: `http://localhost:3000`
- Railway: your generated Railway domain

## Auth Model

- Public endpoints: no auth required.
- Admin endpoints: require `admin_auth` cookie set by `/api/admin/login`.

## Public Endpoints

### Queue and Transcription

- `GET /api/queue/status`
  - Returns global and current-session queue stats and configured limits.

- `POST /api/transcribe/start`
  - Multipart upload endpoint (`video` field).
  - Returns `{ jobId, videoId, filename }` quickly; processing continues async.
  - Optional form field: `timestamps=true|false`.

- `GET /api/transcribe/status/:jobId`
  - Poll transcription status.
  - Response includes `status`, `stage`, `progress` and final transcript on completion.

- `POST /api/transcribe` (legacy synchronous)
  - Multipart upload (`video` field).
  - Blocks until transcription result/error.

### Summaries

- `POST /api/summarize`
  - Body: `{ transcription, prompt, videoIds? }`
  - Returns `{ summary }`.

### YouTube Transcript and Downloads

- `POST /api/youtube/transcript`
  - Body: `{ url, timestamps? }`
  - Regular videos return transcript payload.
  - Live or suspected-live may return `{ isLive: true, useAsyncJob: true, ... }`.

- `POST /api/youtube/live-transcript-start`
  - Body: `{ url, timestamps?, duration? }` where duration is clamped to 30-600 seconds.
  - Returns `{ jobId }`.

- `GET /api/youtube/live-transcript-status/:jobId`
  - Poll status for the live transcription job.
  - Completion includes `result` object.

- `POST /api/youtube/download-start/:videoId`
  - Starts async download job.
  - Body accepts `{ isLive?, duration? }`.
  - Returns `{ jobId }`.

- `GET /api/youtube/download-status/:jobId`
  - Polls download state (`processing`, `ready`, `failed`).

- `GET /api/youtube/download-file/:jobId`
  - Streams ready MP4, then cleans temp file and removes job.

- `GET /api/youtube/download/:videoId` (legacy direct download)
  - Immediate one-shot download flow, kept for compatibility.

### Meta Ads Transcript and Downloads

- `POST /api/metaads/transcript`
  - Body: `{ url, timestamps? }`.
  - Expects Facebook Ad Library URL containing `id=<digits>`.

- `POST /api/metaads/download-start/:adId`
  - Starts async download job for Meta ad video.

- `GET /api/metaads/download-status/:jobId`
  - Poll status for Meta ad download job.

- `GET /api/metaads/download-file/:jobId`
  - Streams finished Meta ad MP4 and cleans up job resources.

## Admin Endpoints

### Auth

- `POST /api/admin/login`
  - Body: `{ password }`
  - Sets `admin_auth` cookie when password matches.

- `POST /api/admin/logout`
  - Clears `admin_auth` cookie.

- `GET /api/admin/check`
  - Returns `{ authenticated: boolean }`.

### Admin Data

- `GET /api/admin/stats`
  - Returns DB totals plus queue stats.

- `GET /api/admin/videos`
  - Returns videos and associated transcript rows.

- `GET /api/admin/summaries`
  - Returns stored summaries sorted newest first.

- `GET /api/admin/transcript/:videoId/download`
  - Downloads plain text transcript for a video ID.

### Admin Page

- `GET /admin`
  - Serves `public/admin.html`.

## Common Error Conditions

- `400`: invalid URL, missing params, invalid IDs, or file missing.
- `401`: admin auth failure.
- `404`: job or artifact not found.
- `429`: per-user queue limit exceeded.
- `500`: external API/tooling failures or missing server config.
