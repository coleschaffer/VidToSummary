# Video Transcriber API Documentation

## Base URL

```
http://localhost:3000  (development)
https://your-app.up.railway.app  (production)
```

## Authentication

Most endpoints are public. Admin endpoints require authentication via the `admin_auth` cookie.

---

## Public Endpoints

### Upload & Transcribe

#### `POST /api/transcribe/start`

Start a new transcription job. Returns immediately with a job ID for polling.

**Request:**
- Content-Type: `multipart/form-data`
- Body: `video` - Video or audio file (MP4, WebM, MOV, MP3, WAV, M4A)
- Max file size: 1GB

**Response:**
```json
{
  "jobId": "job_1706630400000_abc123def",
  "videoId": 1,
  "filename": "lecture.mp4"
}
```

**Error Responses:**
- `400` - No video file uploaded
- `429` - Queue limit reached (too many jobs)
- `500` - Server error

---

#### `GET /api/transcribe/status/:jobId`

Poll for transcription status.

**Response (Processing):**
```json
{
  "jobId": "job_1706630400000_abc123def",
  "filename": "lecture.mp4",
  "videoId": 1,
  "status": "processing",
  "stage": "transcribing",
  "progress": 45
}
```

**Response (Completed):**
```json
{
  "jobId": "job_1706630400000_abc123def",
  "filename": "lecture.mp4",
  "videoId": 1,
  "status": "completed",
  "stage": "done",
  "progress": 100,
  "transcription": "Full transcription text..."
}
```

**Status Values:**
- `processing` - Job is being processed
- `completed` - Transcription finished successfully
- `error` - Transcription failed

**Stage Values:**
- `uploading` - Uploading to AssemblyAI
- `queued` - Waiting in AssemblyAI queue
- `transcribing` - Being transcribed
- `done` - Finished

**Error Response:**
- `404` - Job not found

---

#### `POST /api/transcribe` (Legacy)

Synchronous transcription endpoint. Blocks until complete.

**Request:**
- Content-Type: `multipart/form-data`
- Body: `video` - Video or audio file

**Response:**
```json
{
  "filename": "lecture.mp4",
  "transcription": "Full transcription text...",
  "videoId": 1
}
```

---

### Summarization

#### `POST /api/summarize`

Run a prompt on transcription(s) using Claude.

**Request:**
```json
{
  "transcription": "Combined transcription text...",
  "prompt": "Summarize this lesson for students...",
  "videoIds": [1, 2, 3]
}
```

**Response:**
```json
{
  "summary": "## Summary\n\nThe lesson covered..."
}
```

**Error Responses:**
- `400` - Missing transcription or prompt
- `500` - Claude API error

---

### Queue Status

#### `GET /api/queue/status`

Get current queue status for the session.

**Response:**
```json
{
  "global": {
    "totalJobs": 5,
    "processingJobs": 3,
    "maxGlobalConcurrent": 10,
    "maxUserConcurrent": 3,
    "maxUserQueue": 10
  },
  "user": {
    "totalJobs": 2,
    "processingJobs": 1,
    "queuedJobs": 1,
    "canAddMore": true,
    "canStartProcessing": true
  },
  "limits": {
    "maxGlobalConcurrent": 10,
    "maxUserConcurrent": 3,
    "maxUserQueue": 10
  }
}
```

---

## Admin Endpoints

All admin endpoints require authentication.

### Authentication

#### `POST /api/admin/login`

Login to admin dashboard.

**Request:**
```json
{
  "password": "your-admin-password"
}
```

**Response:**
```json
{
  "success": true
}
```

Sets `admin_auth` cookie on success.

---

#### `POST /api/admin/logout`

Logout from admin dashboard.

**Response:**
```json
{
  "success": true
}
```

---

#### `GET /api/admin/check`

Check authentication status.

**Response:**
```json
{
  "authenticated": true
}
```

---

### Admin Data

#### `GET /api/admin/stats`

Get system statistics.

**Response:**
```json
{
  "totalVideos": 150,
  "totalTranscripts": 145,
  "totalSummaries": 89,
  "queue": {
    "totalJobs": 5,
    "processingJobs": 3,
    "maxGlobalConcurrent": 10,
    "maxUserConcurrent": 3,
    "maxUserQueue": 10
  }
}
```

---

#### `GET /api/admin/videos`

Get all videos with transcripts.

**Response:**
```json
[
  {
    "id": 1,
    "filename": "lecture.mp4",
    "size": 52428800,
    "mimeType": "video/mp4",
    "createdAt": "2024-01-30T12:00:00Z",
    "transcript": "Full transcription..."
  }
]
```

---

#### `GET /api/admin/summaries`

Get all summaries.

**Response:**
```json
[
  {
    "id": 1,
    "prompt": "Summarize this lesson...",
    "summary": "## Summary...",
    "videoIds": [1, 2],
    "createdAt": "2024-01-30T12:30:00Z"
  }
]
```

---

#### `GET /api/admin/transcript/:videoId/download`

Download transcript as text file.

**Response:**
- Content-Type: `text/plain`
- Content-Disposition: `attachment; filename="transcript-1.txt"`

---

## Rate Limiting

### Session Tracking

Users are identified by a session cookie (`vt_session`). If no cookie exists, one is created automatically.

### Limits

| Limit | Default | Description |
|-------|---------|-------------|
| Global Concurrent | 10 | Max jobs processing across all users |
| User Concurrent | 3 | Max jobs processing per user |
| User Queue | 10 | Max jobs in queue per user |

### Rate Limit Response

When limits are exceeded:

```json
{
  "error": "Queue limit reached",
  "message": "You can only have 10 videos in your queue at a time. Please wait for some to complete.",
  "limits": {
    "totalJobs": 10,
    "processingJobs": 3,
    "queuedJobs": 7,
    "canAddMore": false,
    "canStartProcessing": true
  }
}
```

---

## Error Handling

All error responses follow this format:

```json
{
  "error": "Error message"
}
```

### Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad request (missing/invalid parameters) |
| 401 | Unauthorized (admin endpoints) |
| 404 | Not found |
| 429 | Rate limited |
| 500 | Server error |

---

## CORS Headers

The server sets these headers for FFmpeg.wasm compatibility:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

---

## File Size Limits

- **Upload limit:** 1GB (1,073,741,824 bytes)
- **JSON body limit:** 50MB
- **Recommended:** Extract audio client-side using FFmpeg.wasm to reduce upload size by ~90%
