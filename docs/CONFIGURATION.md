# Video Transcriber Configuration

## Environment Variables

Create a `.env` file in the project root with the following variables:

### Required

```bash
# AssemblyAI API Key
# Get from: https://www.assemblyai.com/dashboard
ASSEMBLYAI_API_KEY=your_assemblyai_api_key

# Anthropic API Key
# Get from: https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=your_anthropic_api_key
```

### Optional

```bash
# Server port (default: 3000)
PORT=3000

# Admin dashboard password (default: 2323)
ADMIN_PASSWORD=your_secure_password

# PostgreSQL connection string (optional - app works without it)
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Rate limiting configuration
MAX_GLOBAL_CONCURRENT=10   # Max concurrent jobs across all users
MAX_USER_CONCURRENT=3      # Max concurrent jobs per user
MAX_USER_QUEUE=10          # Max queued jobs per user

# Node environment
NODE_ENV=production        # Set to 'production' in deployment
```

---

## Rate Limiting Settings

### Global Concurrent Limit

**Variable:** `MAX_GLOBAL_CONCURRENT`
**Default:** `10`

Maximum number of transcription jobs that can be processing simultaneously across all users. Increase this if you have more server resources and API quota.

### Per-User Concurrent Limit

**Variable:** `MAX_USER_CONCURRENT`
**Default:** `3`

Maximum number of transcription jobs a single user can have processing at once. Prevents one user from monopolizing resources.

### Per-User Queue Limit

**Variable:** `MAX_USER_QUEUE`
**Default:** `10`

Maximum number of jobs (queued + processing) a single user can have at any time. Prevents abuse and ensures fair access.

---

## Cleanup Settings

These are defined in `lib/queue.js` and can be modified there:

```javascript
export const CONFIG = {
  JOB_RETENTION_MS: 10 * 60 * 1000,        // 10 minutes
  UPLOAD_CLEANUP_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
  UPLOAD_MAX_AGE_MS: 30 * 60 * 1000,       // 30 minutes
};
```

### Job Retention Time

How long completed/failed jobs are kept in memory before cleanup. Default: 10 minutes.

### Upload Cleanup Interval

How often the server checks for orphaned upload files. Default: 5 minutes.

### Upload Max Age

Maximum age for files in the uploads directory before they're deleted. Default: 30 minutes.

---

## Server Timeouts

Defined in `server.js`:

```javascript
server.timeout = 600000;        // 10 minutes
server.keepAliveTimeout = 600000;
server.headersTimeout = 600000;
```

These are set high to accommodate large file uploads.

---

## File Upload Limits

### Multer Configuration

```javascript
const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB
  fileFilter: (req, file, cb) => {
    const allowed = [
      'video/mp4',
      'video/webm',
      'video/quicktime',
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/mp4',
      'audio/x-m4a'
    ];
    cb(null, allowed.includes(file.mimetype));
  }
});
```

### JSON Body Limits

```javascript
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
```

---

## Client-Side Configuration

### FFmpeg Settings

Located in `public/script.js`:

```javascript
// Audio extraction bitrate (lower = smaller file, less quality)
'-b:a', '64k'  // 64kbps is good for speech

// Output format
'-f', 'mp3'    // MP3 format for wide compatibility
```

### History Settings

```javascript
const HISTORY_KEY = 'vt_history';  // localStorage key
const MAX_HISTORY_ITEMS = 20;      // Max sessions to keep
```

---

## Security Configuration

### CORS Headers

Required for FFmpeg.wasm SharedArrayBuffer:

```javascript
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});
```

### Admin Cookie

```javascript
res.cookie('admin_auth', password, {
  httpOnly: true,                    // Not accessible via JavaScript
  secure: process.env.NODE_ENV === 'production',  // HTTPS only in prod
  maxAge: 24 * 60 * 60 * 1000       // 24 hours
});
```

### Session Cookie

```javascript
res.cookie('vt_session', sessionId, {
  httpOnly: true,
  maxAge: 24 * 60 * 60 * 1000,  // 24 hours
  sameSite: 'lax'
});
```

---

## Database Configuration

### PostgreSQL (Optional)

The app works without a database, but adding PostgreSQL enables:
- Persistent storage of videos, transcripts, and summaries
- Admin dashboard with historical data
- Cross-session data access

**Connection String Format:**
```
postgresql://username:password@hostname:port/database
```

**Railway PostgreSQL:**
Railway automatically provides `DATABASE_URL` when you add a Postgres plugin.

### Schema

The database is automatically initialized with this schema:

```sql
CREATE TABLE IF NOT EXISTS videos (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  size BIGINT,
  mime_type VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transcripts (
  id SERIAL PRIMARY KEY,
  video_id INTEGER REFERENCES videos(id),
  text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS summaries (
  id SERIAL PRIMARY KEY,
  prompt TEXT NOT NULL,
  summary TEXT NOT NULL,
  video_ids INTEGER[] NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## AI Model Configuration

### Claude Model

The summarization uses Claude Opus 4.5:

```javascript
const message = await anthropic.messages.create({
  model: 'claude-opus-4-5-20251101',
  max_tokens: 4096,
  // ...
});
```

To change the model, modify `server.js` line ~415.

### AssemblyAI

Default transcription settings are used. To customize (speaker diarization, etc.), modify the transcript request in `processTranscription()`:

```javascript
const transcriptRequest = await assemblyai.transcripts.submit({
  audio_url: uploadUrl,
  // Add options here:
  // speaker_labels: true,
  // auto_chapters: true,
  // entity_detection: true,
});
```

---

## Production Checklist

Before deploying to production:

- [ ] Set strong `ADMIN_PASSWORD`
- [ ] Set `NODE_ENV=production`
- [ ] Configure API keys securely (environment variables, not .env)
- [ ] Set appropriate rate limits for your use case
- [ ] Consider adding a PostgreSQL database for persistence
- [ ] Monitor API usage and costs (AssemblyAI, Anthropic)
