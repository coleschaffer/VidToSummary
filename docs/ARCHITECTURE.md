# Video Transcriber Architecture

## Overview

Video Transcriber is a web application that allows users to upload videos, transcribe them using AssemblyAI, and run AI prompts on the transcriptions using Claude.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client (Browser)                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  FFmpeg.wasm │  │  LocalStorage│  │  UI Components          │  │
│  │  (Audio      │  │  (History)   │  │  - Upload Queue         │  │
│  │   Extraction)│  │              │  │  - Transcriptions       │  │
│  └─────────────┘  └─────────────┘  │  - Summaries             │  │
│                                     │  - History Sidebar       │  │
│                                     └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Express.js Server                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Rate Limiter   │  │  Queue Manager  │  │  Job Tracker    │  │
│  │  - Global limit │  │  - Per-user     │  │  - Active jobs  │  │
│  │  - Per-user     │  │    queue limit  │  │  - Auto cleanup │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Multer         │  │  Admin Routes   │  │  API Routes     │  │
│  │  (File Upload)  │  │  (Dashboard)    │  │  (Transcribe)   │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   AssemblyAI    │  │   Anthropic     │  │   PostgreSQL    │
│   (Transcribe)  │  │   (Claude)      │  │   (Optional)    │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

## Data Flow

### Video Upload & Transcription

1. User drops video file(s) in the upload zone
2. FFmpeg.wasm extracts audio from video (reduces file size ~90%)
3. Audio file is uploaded to the server
4. Server uploads audio to AssemblyAI
5. Server polls AssemblyAI for transcription status
6. Client polls server for progress updates
7. Completed transcription is returned to client
8. Transcription is saved to localStorage history

### Prompt Processing

1. User selects a prompt preset or writes custom prompt
2. Client sends transcription + prompt to server for each video
3. Server calls Claude API with the prompt
4. Results are returned and displayed
5. Summaries are saved to localStorage history

## Rate Limiting & Queue Management

### Global Limits
- **MAX_GLOBAL_CONCURRENT**: Maximum videos processing across all users (default: 10)
- Prevents server overload from too many simultaneous transcriptions

### Per-User Limits
- **MAX_USER_QUEUE**: Maximum videos in a single user's queue (default: 10)
- **MAX_USER_CONCURRENT**: Maximum videos processing per user (default: 3)
- Users identified by session ID (cookie-based)

### Job Cleanup
- **JOB_RETENTION_TIME**: How long completed jobs are kept (default: 10 minutes)
- **UPLOAD_CLEANUP_INTERVAL**: How often to clean orphaned uploads (default: 5 minutes)
- Automatic cleanup prevents disk space issues

## File Structure

```
/
├── server.js           # Express server, API routes
├── db.js               # PostgreSQL operations (optional)
├── lib/
│   └── queue.js        # Queue management & rate limiting
├── public/
│   ├── index.html      # Main app HTML
│   ├── script.js       # Client-side JavaScript
│   ├── styles.css      # Styling
│   ├── admin.html      # Admin dashboard
│   └── ffmpeg/         # Self-hosted FFmpeg.wasm files
├── uploads/            # Temporary file storage (auto-cleaned)
└── docs/               # Documentation
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `ASSEMBLYAI_API_KEY` | AssemblyAI API key | Required |
| `ANTHROPIC_API_KEY` | Anthropic API key | Required |
| `ADMIN_PASSWORD` | Admin dashboard password | 2323 |
| `DATABASE_URL` | PostgreSQL connection string | Optional |
| `MAX_GLOBAL_CONCURRENT` | Global concurrent limit | 10 |
| `MAX_USER_CONCURRENT` | Per-user concurrent limit | 3 |
| `MAX_USER_QUEUE` | Per-user queue limit | 10 |

## Client-Side Storage

### localStorage Keys

- `vt_history`: Array of past sessions with transcriptions and summaries
- `vt_session_id`: Unique session identifier for rate limiting

### History Structure

```javascript
{
  sessions: [
    {
      id: "session_123",
      date: "2024-01-30T12:00:00Z",
      videos: [
        { filename: "video.mp4", transcription: "..." }
      ],
      summaries: [
        { filename: "video.mp4", prompt: "...", summary: "..." }
      ]
    }
  ]
}
```
