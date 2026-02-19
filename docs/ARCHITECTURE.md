# Architecture

## Overview

Video Transcriber is a single Node.js/Express service with a browser frontend. It supports:

- File upload transcription (audio extracted in-browser when possible).
- YouTube transcript retrieval through Supadata with live-stream fallback.
- Meta Ads transcript extraction through yt-dlp + AssemblyAI.
- Prompt-based summarization through Anthropic Claude.
- Optional PostgreSQL persistence for admin analytics/history.

## Runtime Components

### Browser (`public/index.html`, `public/script.js`, `public/styles.css`)

- Manages upload queue, polling, history, saved prompts, summaries, and downloads.
- Uses local FFmpeg WASM (`public/ffmpeg/*`) for client-side audio extraction and clip creation.
- Uses localStorage keys:
  - `vt_settings`
  - `vt_history`
  - `vt_saved_prompts`

### Express API (`server.js`)

- Serves static frontend and admin pages.
- Handles auth cookie checks for admin routes.
- Manages async transcription and download jobs in memory.
- Integrates with external providers:
  - AssemblyAI (transcription)
  - Anthropic (summaries and optional translation)
  - Supadata (YouTube transcript source)
  - yt-dlp/ffmpeg (video fetch and live stream capture)

### Queue Layer (`lib/queue.js`)

- Enforces per-session and global concurrency/queue limits.
- Tracks queued/processing/completed jobs.
- Cleans old jobs and stale upload files on intervals.

### Optional Database (`db.js`)

- Initializes tables (`videos`, `transcripts`, `summaries`) if `DATABASE_URL` exists.
- App remains functional without DB; persistence/admin data becomes best-effort in-memory behavior.

## In-Memory Job Stores

`server.js` uses maps for async lifecycle state:

- `activeTranscriptions`: file upload transcriptions.
- `liveTranscriptionJobs`: live YouTube jobs.
- `videoDownloadJobs`: YouTube/Meta Ads download jobs.

All have TTL-like cleanup logic using intervals and delayed removal.

## Main Data Flows

### 1) File Upload Transcription

1. Browser queues file(s).
2. Browser may convert video to MP3 via FFmpeg WASM.
3. `POST /api/transcribe/start` stores upload and creates job.
4. Server uploads media to AssemblyAI and polls status.
5. Browser polls `GET /api/transcribe/status/:jobId`.
6. Completed transcript appears in UI and local history.

### 2) YouTube Transcript Flow

1. Browser calls `POST /api/youtube/transcript` with URL.
2. Server normalizes URL and queries Supadata pipeline.
3. If non-English transcript, server can translate to English via Claude.
4. For likely live streams, server returns `useAsyncJob`.
5. Browser starts async live pipeline and polls `/api/youtube/live-transcript-status/:jobId`.

### 3) Meta Ads Transcript Flow

1. Browser sends ad library URL to `POST /api/metaads/transcript`.
2. Server extracts ad ID and downloads video via yt-dlp + proxy.
3. Server transcribes audio via AssemblyAI.
4. Transcript is returned to browser for normal downstream summary flow.

### 4) Summarization

1. Browser sends transcript and prompt to `POST /api/summarize`.
2. Server calls Claude Opus 4.5.
3. Markdown summary returns to browser and can be persisted to DB when video IDs are provided.

## Security and Isolation Notes

- Admin authentication uses a cookie equal to `ADMIN_PASSWORD`.
- SharedArrayBuffer headers (COOP/COEP) are enabled globally for FFmpeg WASM.
- Queue limits are session-cookie based (`vt_session`).
- Uploaded files and temp downloads are periodically cleaned up.

## Failure Model

- Missing external keys or providers generally fail per-request with explicit errors.
- Missing PostgreSQL does not crash startup; persistence endpoints degrade gracefully.
- Long-running jobs expose status polling and timeout behavior in frontend logic.
