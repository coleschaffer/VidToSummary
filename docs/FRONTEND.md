# Frontend Guide

## Files

- `public/index.html`: Main user app layout.
- `public/script.js`: All client logic.
- `public/styles.css`: Styling for user app.
- `public/admin.html`: Standalone admin UI with inline CSS/JS.
- `public/ffmpeg/*`: Vendored FFmpeg WASM runtime and helpers.

## User App Structure (`public/index.html`)

Main sections:

- Settings sidebar (timestamps, live duration).
- History sidebar.
- Input tabs:
  - File upload
  - YouTube URL
  - Meta Ads URL
- Upload queue section.
- Transcription results section.
- Prompt and summary output section.

External browser dependencies loaded by CDN:

- `marked`
- `jszip`

Local runtime scripts:

- `/ffmpeg/ffmpeg.min.js`
- `/ffmpeg/util.min.js`
- `/script.js`

## State Model (`public/script.js`)

In-memory state:

- `uploadQueue`
- `transcriptions`
- `summaries`

Persisted keys:

- `vt_settings`
- `vt_history`
- `vt_saved_prompts`

## Main Client Flows

### Upload Flow

- Dropzone and file picker push media into queue.
- Videos can be converted to MP3 via FFmpeg WASM before upload.
- Upload hits `/api/transcribe/start`.
- Polling uses `/api/transcribe/status/:jobId`.

### URL Transcript Flows

- YouTube URLs call `/api/youtube/transcript`.
- Live fallback starts `/api/youtube/live-transcript-start` and polls live status.
- Meta Ads URLs call `/api/metaads/transcript`.

### Summary Flow

- User chooses preset/custom/saved prompt.
- For each transcript, client calls `/api/summarize`.
- Markdown output is rendered with `marked`.

### Download Flows

- Transcript and summary downloads (single and ZIP).
- Async server-backed video downloads for YouTube and Meta Ads.
- Clip creation modal downloads source video then slices clips in-browser with FFmpeg WASM.

## Admin UI (`public/admin.html`)

- Login form posts to `/api/admin/login`.
- Dashboard fetches:
  - `/api/admin/stats`
  - `/api/admin/videos`
  - `/api/admin/summaries`
- Provides transcript file download links per video.
