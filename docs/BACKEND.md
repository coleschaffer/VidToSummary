# Backend Guide

## Modules

### `server.js`

Responsibilities:

- App bootstrap, middleware setup, and static serving.
- Admin auth and admin data routes.
- File upload transcription flow and polling.
- YouTube transcript pipeline (Supadata + translation fallback).
- Live stream handling and long-running async jobs.
- Meta Ads transcript and download support.
- Async download job management for YouTube and Meta Ads.

Key internal helpers:

- URL and language helpers: `normalizeYouTubeUrl`, `isLikelyEnglish`, `decodeHtmlEntities`.
- Timestamp helpers: `formatTimestamp`, `buildTimestampedTranscript`.
- External-pipeline wrappers: `fetchSupadataTranscript`, `fetchTranscriptViaPipeline`, `downloadLiveStreamAudio`.
- Job workers: `processTranscription`, `processLiveTranscription`.

### `lib/queue.js`

Responsibilities:

- Session ID generation via cookie.
- In-memory tracking of global and per-user jobs.
- Rate-limit middleware before expensive processing.
- TTL cleanup of completed jobs and stale upload files.

Public exports used by server:

- `CONFIG`
- `getSessionId`
- `getGlobalStats`
- `getUserStats`
- `canUserAddJob`
- `canUserStartJob`
- `registerJob`
- `updateJobStatus`
- `completeJob`
- `failJob`
- `getJob`
- `removeJob`
- `startCleanupIntervals`
- `rateLimitMiddleware`

### `db.js`

Responsibilities:

- Optional PostgreSQL pool creation when `DATABASE_URL` exists.
- Startup schema initialization.
- CRUD helpers for videos, transcripts, summaries, and aggregate stats.
- Graceful no-op behavior when DB is unavailable.

## Database Schema

Created automatically by `initDb()`:

- `videos(id, filename, file_size, mime_type, created_at)`
- `transcripts(id, video_id, transcript_text, created_at)`
- `summaries(id, prompt, summary_text, video_ids, created_at)`

## Background Job Lifecycles

### Upload Transcription Job

- Created in `/api/transcribe/start`.
- Tracked in `activeTranscriptions` + queue manager.
- Runs `processTranscription()`.
- Cleans in-memory state after completion/error polling.

### Live Transcript Job

- Created in `/api/youtube/live-transcript-start`.
- Tracked in `liveTranscriptionJobs`.
- Runs `processLiveTranscription()`.
- Cleanup interval removes stale jobs > 30 minutes.

### Video Download Job

- Created in `/api/youtube/download-start/:videoId` or `/api/metaads/download-start/:adId`.
- Tracked in `videoDownloadJobs`.
- Status polled by frontend; file streamed from `/download-file/:jobId`.
- File and job are removed after stream completion or TTL cleanup.

## Error Handling Pattern

- External command and API calls are wrapped in `try/catch`.
- Temp files are aggressively cleaned in both success and failure paths.
- Client-facing errors are normalized into JSON `{ error: string }` messages.
