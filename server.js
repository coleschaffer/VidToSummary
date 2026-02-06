import express from 'express';
import multer from 'multer';
import { AssemblyAI } from 'assemblyai';
import Anthropic from '@anthropic-ai/sdk';
import { exec } from 'child_process';
import { promisify } from 'util';
import { unlinkSync, mkdirSync, existsSync, writeFileSync, readFileSync, createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { initDb, saveVideo, saveTranscript, saveSummary, getVideos, getSummaries, getStats, getTranscript } from './db.js';
import {
  CONFIG,
  getSessionId,
  getGlobalStats,
  getUserStats,
  canUserAddJob,
  canUserStartJob,
  registerJob,
  updateJobStatus,
  completeJob,
  failJob,
  getJob,
  removeJob,
  startCleanupIntervals,
  rateLimitMiddleware
} from './lib/queue.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '2323';

// Initialize database (optional - app works without it)
initDb().then(() => {
  console.log('Database connected successfully');
}).catch(err => {
  console.warn('Database not available:', err.message);
  console.warn('App will work but data won\'t be persisted');
});

// Ensure uploads directory exists
const uploadsDir = join(__dirname, 'uploads');
if (!existsSync(uploadsDir)) {
  mkdirSync(uploadsDir, { recursive: true });
}

// Start cleanup intervals
startCleanupIntervals(uploadsDir);

// Configure multer for video uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/mp4', 'audio/x-m4a'];
    const isAllowed = allowed.includes(file.mimetype);
    console.log(`[Multer] File: ${file.originalname}, MIME: ${file.mimetype}, Allowed: ${isAllowed}`);
    cb(null, isAllowed);
  }
});

// AssemblyAI for transcription
const assemblyai = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });

// Anthropic for summarization (Claude Opus 4.5)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Supadata API for YouTube transcripts
const SUPADATA_API_KEY = process.env.SUPADATA_API_KEY;

// Decodo proxy for YouTube video downloads (via yt-dlp)
const DECODO_PROXY_USER = process.env.DECODO_PROXY_USER;
const DECODO_PROXY_PASS = process.env.DECODO_PROXY_PASS;
const DECODO_PROXY_HOST = 'gate.decodo.com';
// Use ports 10001-10010 randomly for load distribution
const getProxyUrl = () => {
  const port = 10001 + Math.floor(Math.random() * 10);
  return `http://${DECODO_PROXY_USER}:${DECODO_PROXY_PASS}@${DECODO_PROXY_HOST}:${port}`;
};

// Promisify exec for async/await usage
const execAsync = promisify(exec);

// Translate transcript to English using Claude (with chunking for large texts)
async function translateToEnglish(text, sourceLang) {
  // Check if Anthropic API is configured
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[API] Translation skipped: ANTHROPIC_API_KEY not configured');
    return text;
  }

  const CHUNK_SIZE = 4000; // Characters per chunk

  try {
    console.log(`[API] Starting translation of ${text.length} chars from ${sourceLang}`);
    const startTime = Date.now();

    // If text is small enough, translate in one call
    if (text.length <= CHUNK_SIZE) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: `Translate the following transcript from ${sourceLang} to English. Provide only the translated text, maintaining the original formatting and structure. Do not add any explanations or notes.

Transcript:
${text}`
        }]
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[API] Translation complete in ${elapsed}s`);
      return response.content[0].text;
    }

    // For large texts, split into chunks and translate each
    const chunks = [];
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
      chunks.push(text.slice(i, i + CHUNK_SIZE));
    }

    console.log(`[API] Splitting into ${chunks.length} chunks for parallel translation`);

    // Translate all chunks in parallel for faster processing
    const translationPromises = chunks.map((chunk, i) => {
      console.log(`[API] Starting translation of chunk ${i + 1}/${chunks.length}`);
      return anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: `Translate the following transcript segment from ${sourceLang} to English. This is part ${i + 1} of ${chunks.length}. Provide only the translated text, maintaining the original formatting. Do not add any explanations, notes, or segment markers.

Transcript segment:
${chunk}`
        }]
      });
    });

    const responses = await Promise.all(translationPromises);
    const translatedChunks = responses.map(r => r.content[0].text);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[API] Translation complete in ${elapsed}s (${chunks.length} chunks in parallel)`);

    return translatedChunks.join(' ');
  } catch (error) {
    console.error('[API] Translation error:', error.message);
    // Return original text if translation fails
    return text;
  }
}

// Decode HTML entities in transcript text
function decodeHtmlEntities(text) {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ');
}

// Format milliseconds as H:MM:SS or M:SS timestamp
function formatTimestamp(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// Build timestamped transcript from AssemblyAI word-level data
function buildTimestampedTranscript(words) {
  if (!words || words.length === 0) return '';
  let lines = [];
  let currentLine = [];
  let lineStart = words[0].start;
  for (const word of words) {
    if (currentLine.length === 0) lineStart = word.start;
    currentLine.push(word.text);
    if (word.text.match(/[.!?]$/)) {
      lines.push(`[${formatTimestamp(lineStart)}] ${currentLine.join(' ')}`);
      currentLine = [];
    }
  }
  if (currentLine.length > 0) {
    lines.push(`[${formatTimestamp(lineStart)}] ${currentLine.join(' ')}`);
  }
  return lines.join('\n');
}

// Detect if text is likely English based on common words
function isLikelyEnglish(text) {
  const sample = text.slice(0, 2000).toLowerCase();
  const englishWords = ['the', 'and', 'that', 'have', 'for', 'not', 'with', 'you', 'this', 'but', 'from', 'they', 'would', 'there', 'their', 'what', 'about', 'which', 'when', 'make', 'like', 'just', 'know', 'take', 'people', 'into', 'could', 'time', 'some', 'than', 'them', 'look', 'only', 'come', 'over', 'think', 'also'];
  const matches = englishWords.filter(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'g');
    return (sample.match(regex) || []).length >= 2;
  });
  // If 10+ common English words appear at least twice each, it's likely English
  return matches.length >= 10;
}

// Normalize any YouTube URL to https://www.youtube.com/watch?v=VIDEO_ID
// yt-dlp and Supadata can fail on /live/ URLs, so always convert first
function normalizeYouTubeUrl(url) {
  const videoId = url.match(/(?:v=|youtu\.be\/|live\/)([^&\s?]+)/)?.[1];
  if (videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }
  return url;
}

// Check if a YouTube video is a live stream using yt-dlp
async function isYouTubeLive(url) {
  try {
    const normalizedUrl = normalizeYouTubeUrl(url);
    const proxyUrl = getProxyUrl();
    const { stdout } = await execAsync(
      `yt-dlp --proxy "${proxyUrl}" --dump-json --no-download "${normalizedUrl}"`,
      { timeout: 30000 }
    );
    const info = JSON.parse(stdout);
    return info.is_live === true || info.live_status === 'is_live';
  } catch (error) {
    console.log(`[API] Could not check live status: ${error.message}`);
    return false;
  }
}

// Fast check if URL looks like a live stream (e.g. youtube.com/live/...)
function looksLikeLiveUrl(url) {
  return /youtube\.com\/live\//.test(url);
}

// Download audio from a live YouTube stream (limited duration)
async function downloadLiveStreamAudio(url, durationSeconds = 120) {
  const proxyUrl = getProxyUrl();
  const tempDir = join(__dirname, 'temp');
  if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

  const videoId = url.match(/(?:v=|youtu\.be\/|live\/)([^&\s]+)/)?.[1] || Date.now();
  const timestamp = Date.now();
  const rawFile = join(tempDir, `livestream_raw_${videoId}_${timestamp}.mp4`);
  const outputFile = join(tempDir, `livestream_${videoId}_${timestamp}.mp3`);

  // For live streams: get the direct stream URL and use ffmpeg to record a duration
  // First, get the stream URL using yt-dlp
  const normalizedUrl = normalizeYouTubeUrl(url);
  console.log(`[API] Getting live stream URL...`);
  const getUrlCmd = `yt-dlp --proxy "${proxyUrl}" --extractor-args "youtube:player_client=android" -f "bestaudio*/best" -g --no-playlist --no-check-certificates "${normalizedUrl}"`;

  const { stdout: streamUrl } = await execAsync(getUrlCmd, { timeout: 60000 });
  const directUrl = streamUrl.trim().split('\n')[0];

  if (!directUrl) {
    throw new Error('Could not get live stream URL');
  }

  // Use ffmpeg directly to record from the stream URL with duration limit
  console.log(`[API] Recording ${durationSeconds}s from live stream...`);
  const ffmpegCmd = `ffmpeg -i "${directUrl}" -t ${durationSeconds} -c copy "${rawFile}" -y`;

  const ffmpegTimeout = (durationSeconds * 1.5 + 60) * 1000;
  await execAsync(ffmpegCmd, { timeout: ffmpegTimeout });

  if (!existsSync(rawFile)) {
    throw new Error('Live stream recording completed but file not found');
  }

  // Convert to mp3 for AssemblyAI
  console.log('[API] Converting live stream audio to mp3...');
  await execAsync(`ffmpeg -i "${rawFile}" -vn -acodec libmp3lame -q:a 2 "${outputFile}" -y`, { timeout: 60000 });

  // Clean up raw file
  try { unlinkSync(rawFile); } catch {}

  return outputFile;
}

// Transcribe a live YouTube stream using yt-dlp + AssemblyAI
async function transcribeLiveStream(url, timestamps = false) {
  let tempFile = null;

  try {
    // 1. Download audio from live stream (2 minutes)
    console.log('[API] Downloading live stream audio...');
    tempFile = await downloadLiveStreamAudio(url, 120);

    if (!existsSync(tempFile)) {
      throw new Error('Live stream download completed but file not found');
    }

    // 2. Get video title
    let title = 'Live Stream';
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const oembedResponse = await fetch(oembedUrl);
      if (oembedResponse.ok) {
        const oembedData = await oembedResponse.json();
        title = oembedData.title || title;
      }
    } catch (e) {
      console.log(`[API] Could not fetch live stream title: ${e.message}`);
    }

    // 3. Upload to AssemblyAI
    console.log('[API] Uploading live stream audio to AssemblyAI...');
    const uploadUrl = await assemblyai.files.upload(tempFile);
    console.log('[API] Upload complete, submitting transcription...');

    // 4. Submit transcription
    const transcriptRequest = await assemblyai.transcripts.submit({ audio_url: uploadUrl });

    // 5. Poll for completion
    let transcript;
    let pollCount = 0;
    while (true) {
      transcript = await assemblyai.transcripts.get(transcriptRequest.id);
      pollCount++;

      if (transcript.status === 'completed') {
        console.log(`[API] Live stream transcription complete after ${pollCount} polls`);
        break;
      }
      if (transcript.status === 'error') {
        throw new Error(transcript.error || 'Live stream transcription failed');
      }

      console.log(`[API] Transcription status: ${transcript.status} (poll ${pollCount})`);
      await new Promise(r => setTimeout(r, 3000));
    }

    // 6. Clean up temp file
    try { unlinkSync(tempFile); } catch {}

    const videoId = url.match(/(?:v=|youtu\.be\/|live\/)([^&\s]+)/)?.[1] || 'live';

    const transcriptText = timestamps ? buildTimestampedTranscript(transcript.words) : transcript.text;

    return {
      transcript: transcriptText,
      videoId: videoId,
      title: title + ' (Live)',
      source: 'youtube'
    };

  } catch (error) {
    // Clean up on error
    if (tempFile) {
      try { unlinkSync(tempFile); } catch {}
    }
    throw error;
  }
}

// Fetch transcript from Supadata with language preference
async function fetchSupadataTranscript(url, lang, mode = 'auto', timestamps = false) {
  const textParam = timestamps ? '' : '&text=true';
  const supadataUrl = `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(url)}${textParam}&lang=${lang}&mode=${mode}`;
  const response = await fetch(supadataUrl, {
    method: 'GET',
    headers: { 'x-api-key': SUPADATA_API_KEY }
  });

  // Handle async job (202 response)
  if (response.status === 202) {
    const { jobId } = await response.json();
    console.log(`[API] Supadata job started: ${jobId}`);

    let pollCount = 0;
    const maxPolls = 120;
    while (pollCount < maxPolls) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const pollResponse = await fetch(`https://api.supadata.ai/v1/transcript/${jobId}`, {
        headers: { 'x-api-key': SUPADATA_API_KEY }
      });
      const pollData = await pollResponse.json();

      if (pollData.status === 'completed') {
        return { content: pollData.content, lang: pollData.lang, availableLangs: pollData.availableLangs || [] };
      } else if (pollData.status === 'failed') {
        throw new Error('Supadata transcription failed');
      }
      pollCount++;
    }
    throw new Error('Transcript polling timed out');
  }

  // Handle errors
  if (!response.ok) {
    let errorMsg = `Supadata API error: ${response.status}`;
    try {
      const errorBody = await response.json();
      if (errorBody.error) errorMsg = errorBody.error;
      if (errorBody.message) errorMsg = errorBody.message;
    } catch (e) { /* ignore parse errors */ }

    if (response.status === 206) throw new Error('No transcript available for this video');
    if (response.status === 404) throw new Error('Video not found or is private');
    if (response.status === 403) throw new Error('Video requires authentication or is restricted');
    if (response.status === 400) {
      // 400 often means live stream or unsupported video type
      if (errorMsg.toLowerCase().includes('live')) {
        throw new Error('Live streams do not have transcripts until the stream ends and is archived');
      }
      throw new Error(errorMsg || 'Video may be a live stream or unsupported format');
    }
    throw new Error(errorMsg);
  }

  const data = await response.json();
  return { content: data.content, lang: data.lang, availableLangs: data.availableLangs || [] };
}

// IMPORTANT: Enable SharedArrayBuffer for FFmpeg.wasm
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

app.use(express.static(join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Admin authentication middleware
function requireAdmin(req, res, next) {
  const authCookie = req.cookies.admin_auth;
  if (authCookie === ADMIN_PASSWORD) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.cookie('admin_auth', password, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Admin logout
app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('admin_auth');
  res.json({ success: true });
});

// Check admin auth status
app.get('/api/admin/check', (req, res) => {
  const authCookie = req.cookies.admin_auth;
  res.json({ authenticated: authCookie === ADMIN_PASSWORD });
});

// Admin stats
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const dbStats = await getStats();
    const queueStats = getGlobalStats();
    res.json({ ...dbStats, queue: queueStats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin get all videos with transcripts
app.get('/api/admin/videos', requireAdmin, async (req, res) => {
  try {
    const videos = await getVideos();
    res.json(videos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin get all summaries
app.get('/api/admin/summaries', requireAdmin, async (req, res) => {
  try {
    const summaries = await getSummaries();
    res.json(summaries);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Download transcript as text file
app.get('/api/admin/transcript/:videoId/download', requireAdmin, async (req, res) => {
  try {
    const transcript = await getTranscript(parseInt(req.params.videoId));
    if (!transcript) {
      return res.status(404).json({ error: 'Transcript not found' });
    }
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="transcript-${req.params.videoId}.txt"`);
    res.send(transcript);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'admin.html'));
});

// Get queue status for current user
app.get('/api/queue/status', (req, res) => {
  const sessionId = getSessionId(req, res);
  res.json({
    global: getGlobalStats(),
    user: getUserStats(sessionId),
    limits: {
      maxGlobalConcurrent: CONFIG.MAX_GLOBAL_CONCURRENT,
      maxUserConcurrent: CONFIG.MAX_USER_CONCURRENT,
      maxUserQueue: CONFIG.MAX_USER_QUEUE,
    }
  });
});

// Track active transcriptions for progress polling
const activeTranscriptions = new Map();

// Track live stream transcription jobs
const liveTranscriptionJobs = new Map();

// Clean up old live transcription jobs every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [jobId, job] of liveTranscriptionJobs) {
    if (now - job.createdAt > 30 * 60 * 1000) {
      liveTranscriptionJobs.delete(jobId);
    }
  }
}, 10 * 60 * 1000);

// Start transcription - returns job ID for progress polling
app.post('/api/transcribe/start', rateLimitMiddleware, (req, res, next) => {
  const contentLength = req.headers['content-length'];
  console.log(`[API] /api/transcribe/start - Upload starting... Content-Length: ${contentLength}`);
  next();
}, upload.single('video'), async (req, res) => {
  console.log(`[API] /api/transcribe/start - Upload complete, processing...`);
  console.log(`[API] File received:`, req.file ? `${req.file.originalname} (${req.file.size} bytes)` : 'NONE');

  if (!req.file) {
    console.log(`[API] /api/transcribe/start - No file received!`);
    return res.status(400).json({ error: 'No video file uploaded' });
  }

  const sessionId = req.sessionId;
  const filename = req.file.originalname;
  const fileSize = (req.file.size / (1024 * 1024)).toFixed(1);
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const timestamps = req.body?.timestamps === 'true';

  console.log(`\n[API] ========== Starting job ${jobId}: ${filename} (${fileSize}MB) [User: ${sessionId}] timestamps=${timestamps} ==========`);

  try {
    // Register job with queue manager
    registerJob(jobId, sessionId, filename);

    // Save video to database
    const videoId = await saveVideo(req.file.originalname, req.file.size, req.file.mimetype);
    console.log(`[API] [${jobId}] Saved to DB with videoId: ${videoId}`);

    // Initialize job tracking
    activeTranscriptions.set(jobId, {
      filename,
      videoId,
      sessionId,
      filePath: req.file.path,
      stage: 'uploading',
      progress: 0,
      status: 'processing',
      startTime: Date.now(),
      timestamps
    });

    // Update queue status
    updateJobStatus(jobId, 'processing');

    // Start async transcription process
    processTranscription(jobId);

    res.json({ jobId, videoId, filename });
  } catch (error) {
    console.error(`[API] [${jobId}] Failed to start:`, error);
    failJob(jobId, error);
    if (req.file?.path) {
      try { unlinkSync(req.file.path); } catch {}
    }
    res.status(500).json({ error: 'Failed to start transcription: ' + error.message });
  }
});

// Async transcription processing
async function processTranscription(jobId) {
  const job = activeTranscriptions.get(jobId);
  if (!job) return;

  try {
    // Stage 1: Upload to AssemblyAI
    job.stage = 'uploading';
    job.progress = 0;
    console.log(`[API] [${jobId}] Uploading to AssemblyAI...`);

    const uploadUrl = await assemblyai.files.upload(job.filePath);
    console.log(`[API] [${jobId}] Upload complete, URL: ${uploadUrl.substring(0, 50)}...`);

    // Clean up local file after upload
    try { unlinkSync(job.filePath); } catch {}

    // Stage 2: Submit for transcription
    job.stage = 'queued';
    job.progress = 0;
    console.log(`[API] [${jobId}] Submitting transcription request...`);

    const transcriptRequest = await assemblyai.transcripts.submit({ audio_url: uploadUrl });
    job.transcriptId = transcriptRequest.id;
    console.log(`[API] [${jobId}] Transcript ID: ${transcriptRequest.id}`);

    // Stage 3: Poll for completion
    job.stage = 'transcribing';
    let transcript;
    let pollCount = 0;

    while (true) {
      transcript = await assemblyai.transcripts.get(job.transcriptId);
      pollCount++;

      if (transcript.status === 'completed') {
        job.progress = 100;
        console.log(`[API] [${jobId}] Transcription complete after ${pollCount} polls`);
        break;
      } else if (transcript.status === 'error') {
        throw new Error(transcript.error || 'Transcription failed');
      } else {
        if (transcript.status === 'queued') {
          job.stage = 'queued';
          job.progress = 0;
        } else if (transcript.status === 'processing') {
          job.stage = 'transcribing';
          const elapsed = (Date.now() - job.startTime) / 1000;
          const estimatedTotal = (job.progress || 30) + Math.min(elapsed / 3, 95);
          job.progress = Math.min(Math.round(estimatedTotal), 95);
        }
        console.log(`[API] [${jobId}] Status: ${transcript.status}, progress: ${job.progress}%`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    // Build transcript text (with or without timestamps)
    const transcriptText = job.timestamps ? buildTimestampedTranscript(transcript.words) : transcript.text;

    // Save transcript to database
    await saveTranscript(job.videoId, transcriptText);

    // Mark complete
    job.status = 'completed';
    job.stage = 'done';
    job.progress = 100;
    job.transcription = transcriptText;

    // Update queue manager
    completeJob(jobId, { transcription: transcriptText });

    const totalTime = ((Date.now() - job.startTime) / 1000).toFixed(1);
    console.log(`[API] [${jobId}] ✓ COMPLETE! Total time: ${totalTime}s, ${transcript.text?.length || 0} chars`);

  } catch (error) {
    console.error(`[API] [${jobId}] ✗ FAILED:`, error.message);
    job.status = 'error';
    job.error = error.message;
    failJob(jobId, error);
    if (job.filePath) {
      try { unlinkSync(job.filePath); } catch {}
    }
  }
}

// Poll transcription status
app.get('/api/transcribe/status/:jobId', (req, res) => {
  const job = activeTranscriptions.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const response = {
    jobId: req.params.jobId,
    filename: job.filename,
    videoId: job.videoId,
    status: job.status,
    stage: job.stage,
    progress: job.progress
  };

  if (job.status === 'completed') {
    response.transcription = job.transcription;
    setTimeout(() => {
      activeTranscriptions.delete(req.params.jobId);
      removeJob(req.params.jobId);
    }, 60000);
  } else if (job.status === 'error') {
    response.error = job.error;
    setTimeout(() => {
      activeTranscriptions.delete(req.params.jobId);
      removeJob(req.params.jobId);
    }, 60000);
  }

  res.json(response);
});

// Legacy endpoint for backwards compatibility
app.post('/api/transcribe', rateLimitMiddleware, upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded' });
  }

  const filename = req.file.originalname;
  console.log(`[API] Legacy transcribe: ${filename}`);

  try {
    const videoId = await saveVideo(req.file.originalname, req.file.size, req.file.mimetype);

    const transcript = await assemblyai.transcripts.transcribe({ audio: req.file.path });
    unlinkSync(req.file.path);

    if (transcript.status === 'error') {
      throw new Error(transcript.error || 'Transcription failed');
    }

    await saveTranscript(videoId, transcript.text);

    res.json({ filename, transcription: transcript.text, videoId });
  } catch (error) {
    console.error('Transcription error:', error);
    if (req.file?.path) {
      try { unlinkSync(req.file.path); } catch {}
    }
    res.status(500).json({ error: 'Transcription failed: ' + error.message });
  }
});

// Summarize transcription with custom prompt using Claude Opus 4.5
app.post('/api/summarize', async (req, res) => {
  const { transcription, prompt, videoIds } = req.body;

  if (!transcription || !prompt) {
    return res.status(400).json({ error: 'Transcription and prompt required' });
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5-20251101',
      max_tokens: 4096,
      system: 'You are a helpful assistant that processes video transcriptions according to user instructions. Format your output clearly with markdown.',
      messages: [
        {
          role: 'user',
          content: `Here is a video transcription:\n\n${transcription}\n\n---\n\n${prompt}`
        }
      ]
    });

    const summaryText = message.content[0].text;

    // Save summary to database
    if (videoIds && videoIds.length > 0) {
      await saveSummary(prompt, summaryText, videoIds);
    }

    res.json({ summary: summaryText });
  } catch (error) {
    console.error('Summarization error:', error);
    res.status(500).json({ error: 'Summarization failed: ' + error.message });
  }
});

// Reusable Supadata pipeline: fetch transcript, try English fallback, translate if needed
async function fetchTranscriptViaPipeline(url, timestamps) {
  // Fetch transcript with mode=auto
  console.log(`[API] Pipeline: fetching transcript with lang=en, mode=auto, timestamps=${!!timestamps}`);
  let result = await fetchSupadataTranscript(url, 'en', 'auto', timestamps);
  console.log(`[API] Pipeline: got transcript, lang: ${result.lang}, availableLangs: ${result.availableLangs?.join(', ') || 'none'}`);

  // If we didn't get English but English is available, fetch it specifically
  if (result.lang && !result.lang.startsWith('en') && result.availableLangs?.length > 0) {
    const englishLang = result.availableLangs.find(l => l.startsWith('en'));
    if (englishLang) {
      console.log(`[API] Pipeline: English available as '${englishLang}', fetching specifically`);
      result = await fetchSupadataTranscript(url, englishLang, 'auto', timestamps);
    }
  }

  // Build transcript text
  let transcript;
  if (timestamps && Array.isArray(result.content)) {
    transcript = result.content.map(seg => `[${formatTimestamp(seg.offset)}] ${seg.text}`).join('\n');
  } else if (Array.isArray(result.content)) {
    transcript = result.content.map(seg => seg.text).join(' ');
  } else {
    transcript = result.content;
  }

  // Determine if translation is needed
  const plainText = timestamps && Array.isArray(result.content)
    ? result.content.map(seg => seg.text).join(' ')
    : transcript;
  const labeledAsEnglish = result.lang?.startsWith('en');
  const contentIsEnglish = isLikelyEnglish(plainText);

  if (!labeledAsEnglish && !contentIsEnglish) {
    console.log(`[API] Pipeline: translating from ${result.lang} to English`);
    transcript = await translateToEnglish(transcript, result.lang);
  } else if (!labeledAsEnglish && contentIsEnglish) {
    console.log(`[API] Pipeline: labeled as '${result.lang}' but content is English - skipping translation`);
  }

  return decodeHtmlEntities(transcript);
}

// Process a live stream transcription job in the background
async function processLiveTranscription(jobId) {
  const job = liveTranscriptionJobs.get(jobId);
  if (!job) return;

  let tempFile = null;
  let recordingTimer = null;
  const normalizedUrl = normalizeYouTubeUrl(job.url);

  try {
    // Stage 1: Detect live stream
    job.stage = 'detecting';
    job.stageLabel = 'Detecting live stream...';
    job.progress = 0;
    console.log(`[API] [${jobId}] Detecting if video is live (normalized: ${normalizedUrl})...`);

    const isLive = await isYouTubeLive(normalizedUrl);
    job.isLive = isLive;

    if (!isLive) {
      // Not actually live - fall back to Supadata pipeline
      console.log(`[API] [${jobId}] Not a live stream, falling back to Supadata`);
      job.stage = 'transcribing';
      job.stageLabel = 'Fetching transcript...';

      let transcript;
      try {
        transcript = await fetchTranscriptViaPipeline(normalizedUrl, job.timestamps);
      } catch (supadataError) {
        // Provide a clearer error than the raw Supadata message
        throw new Error(`Could not fetch transcript for this video. The URL may be invalid or the video may be unavailable. (${supadataError.message})`);
      }

      // Get video title
      let title = job.videoId;
      try {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(normalizedUrl)}&format=json`;
        const oembedResponse = await fetch(oembedUrl);
        if (oembedResponse.ok) {
          const oembedData = await oembedResponse.json();
          title = oembedData.title || title;
        }
      } catch (e) {}

      job.status = 'completed';
      job.stage = 'done';
      job.stageLabel = 'Done';
      job.progress = 100;
      job.result = {
        transcript,
        videoId: job.videoId,
        title,
        source: 'youtube',
        isLive: false
      };
      return;
    }

    // Stage 2: Record audio from live stream
    job.stage = 'recording';
    job.recordingElapsed = 0;
    job.stageLabel = 'Recording audio...';
    job.progress = 0;
    console.log(`[API] [${jobId}] Recording live stream audio...`);

    // Start a timer to update recording progress every second
    recordingTimer = setInterval(() => {
      job.recordingElapsed = Math.min(job.recordingElapsed + 1, job.recordingDuration);
      job.progress = Math.round((job.recordingElapsed / job.recordingDuration) * 100);
      job.stageLabel = `Recording audio (${job.recordingElapsed}/${job.recordingDuration}s)...`;
    }, 1000);

    tempFile = await downloadLiveStreamAudio(normalizedUrl, job.recordingDuration);

    clearInterval(recordingTimer);
    recordingTimer = null;
    job.recordingElapsed = job.recordingDuration;
    job.progress = 100;

    if (!existsSync(tempFile)) {
      throw new Error('Live stream recording completed but file not found');
    }

    // Get video title
    let title = 'Live Stream';
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(normalizedUrl)}&format=json`;
      const oembedResponse = await fetch(oembedUrl);
      if (oembedResponse.ok) {
        const oembedData = await oembedResponse.json();
        title = oembedData.title || title;
      }
    } catch (e) {}

    // Stage 3: Upload to AssemblyAI
    job.stage = 'uploading';
    job.stageLabel = 'Uploading audio...';
    job.progress = 0;
    console.log(`[API] [${jobId}] Uploading to AssemblyAI...`);

    const uploadUrl = await assemblyai.files.upload(tempFile);

    // Clean up temp file after upload
    try { unlinkSync(tempFile); tempFile = null; } catch {}

    // Stage 4: Transcribe
    job.stage = 'transcribing';
    job.stageLabel = 'Transcribing audio...';
    job.progress = 0;
    console.log(`[API] [${jobId}] Submitting transcription...`);

    const transcriptRequest = await assemblyai.transcripts.submit({ audio_url: uploadUrl });

    let transcript;
    let pollCount = 0;
    while (true) {
      transcript = await assemblyai.transcripts.get(transcriptRequest.id);
      pollCount++;

      if (transcript.status === 'completed') {
        console.log(`[API] [${jobId}] Transcription complete after ${pollCount} polls`);
        break;
      }
      if (transcript.status === 'error') {
        throw new Error(transcript.error || 'Transcription failed');
      }

      job.progress = Math.min(pollCount * 10, 95);
      console.log(`[API] [${jobId}] Transcription status: ${transcript.status} (poll ${pollCount})`);
      await new Promise(r => setTimeout(r, 3000));
    }

    const transcriptText = job.timestamps
      ? buildTimestampedTranscript(transcript.words)
      : transcript.text;

    // Stage 5: Done
    job.status = 'completed';
    job.stage = 'done';
    job.stageLabel = 'Done';
    job.progress = 100;
    job.result = {
      transcript: transcriptText,
      videoId: job.videoId,
      title: title + ' (Live)',
      source: 'youtube',
      isLive: true
    };

    const totalTime = ((Date.now() - job.createdAt) / 1000).toFixed(1);
    console.log(`[API] [${jobId}] Live transcription complete in ${totalTime}s`);

  } catch (error) {
    if (recordingTimer) clearInterval(recordingTimer);
    console.error(`[API] [${jobId}] Live transcription failed:`, error.message);
    job.status = 'error';
    job.error = error.message;
    if (tempFile) {
      try { unlinkSync(tempFile); } catch {}
    }
  }
}

// Start a live stream transcription job (returns immediately)
app.post('/api/youtube/live-transcript-start', async (req, res) => {
  const { url, timestamps, duration } = req.body;
  const recordingDuration = Math.min(600, Math.max(30, parseInt(duration) || 120));

  if (!url) {
    return res.status(400).json({ error: 'YouTube URL required' });
  }

  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|v\/|live\/)|youtu\.be\/)[\w-]+/;
  if (!youtubeRegex.test(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  const videoId = url.match(/(?:v=|youtu\.be\/|live\/)([^&\s]+)/)?.[1] || 'live';
  const jobId = `live_${videoId}_${Date.now()}`;

  liveTranscriptionJobs.set(jobId, {
    url,
    videoId,
    timestamps: !!timestamps,
    status: 'processing',
    stage: 'detecting',
    stageLabel: 'Detecting live stream...',
    progress: 0,
    isLive: null,
    recordingDuration,
    recordingElapsed: 0,
    createdAt: Date.now(),
    result: null,
    error: null
  });

  console.log(`[API] [${jobId}] Live transcription job started for: ${url}`);
  res.json({ jobId });

  // Kick off background processing
  processLiveTranscription(jobId);
});

// Poll live stream transcription job status
app.get('/api/youtube/live-transcript-status/:jobId', (req, res) => {
  const job = liveTranscriptionJobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const response = {
    status: job.status,
    stage: job.stage,
    stageLabel: job.stageLabel,
    progress: job.progress,
    isLive: job.isLive,
    recordingDuration: job.recordingDuration,
    recordingElapsed: job.recordingElapsed
  };

  if (job.status === 'completed') {
    response.result = job.result;
    // Clean up after 60 seconds
    setTimeout(() => liveTranscriptionJobs.delete(req.params.jobId), 60000);
  } else if (job.status === 'error') {
    response.error = job.error;
    setTimeout(() => liveTranscriptionJobs.delete(req.params.jobId), 60000);
  }

  res.json(response);
});

// YouTube transcript via Supadata API
app.post('/api/youtube/transcript', async (req, res) => {
  const { url, timestamps } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'YouTube URL required' });
  }

  if (!SUPADATA_API_KEY) {
    return res.status(500).json({ error: 'Supadata API key not configured' });
  }

  // Validate YouTube URL (supports watch, embed, v, live, and youtu.be formats)
  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|v\/|live\/)|youtu\.be\/)[\w-]+/;
  if (!youtubeRegex.test(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  // Fast-path: if URL looks like a live stream, skip Supadata entirely
  if (looksLikeLiveUrl(url)) {
    const videoId = url.match(/(?:v=|youtu\.be\/|live\/)([^&\s]+)/)?.[1] || 'live';
    console.log(`[API] URL looks like a live stream, skipping Supadata: ${url}`);
    return res.json({ isLive: true, useAsyncJob: true, videoId, title: videoId });
  }

  const normalizedUrl = normalizeYouTubeUrl(url);
  console.log(`[API] Fetching YouTube transcript for: ${normalizedUrl}`);

  try {
    const transcript = await fetchTranscriptViaPipeline(normalizedUrl, timestamps);

    // Extract video ID and fetch title
    const videoId = normalizedUrl.match(/(?:v=|youtu\.be\/|live\/)([^&\s]+)/)?.[1] || 'video';
    let title = videoId;

    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(normalizedUrl)}&format=json`;
      const oembedResponse = await fetch(oembedUrl);
      if (oembedResponse.ok) {
        const oembedData = await oembedResponse.json();
        title = oembedData.title || videoId;
      }
    } catch (e) {
      console.log(`[API] Could not fetch video title: ${e.message}`);
    }

    res.json({
      transcript,
      lang: 'en',
      videoId: videoId,
      title: title,
      source: 'youtube'
    });
  } catch (error) {
    console.error('[API] YouTube transcript error:', error);

    // Check if this might be a live stream (400 error, "Invalid Request", or "live" in message)
    const mightBeLive = error.message.includes('400') ||
                        error.message.toLowerCase().includes('live') ||
                        error.message.toLowerCase().includes('invalid request');

    if (mightBeLive) {
      const videoId = url.match(/(?:v=|youtu\.be\/|live\/)([^&\s]+)/)?.[1] || 'live';
      console.log('[API] Supadata failed, might be a live stream - telling client to use async job');
      return res.json({ isLive: true, useAsyncJob: true, videoId, title: videoId });
    }

    res.status(500).json({ error: error.message });
  }
});

// Download Meta Ad video using yt-dlp
async function downloadMetaAdVideo(adId) {
  const proxyUrl = getProxyUrl();
  const tempDir = join(__dirname, 'temp');
  if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
  const tempFile = join(tempDir, `metaad_${adId}_${Date.now()}.mp4`);

  const ytdlpCmd = `yt-dlp --proxy "${proxyUrl}" -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 -o "${tempFile}" --no-playlist --no-check-certificates "https://www.facebook.com/ads/library/?id=${adId}"`;

  console.log(`[API] Running yt-dlp for Meta Ad ${adId}...`);
  await execAsync(ytdlpCmd, { timeout: 300000 }); // 5 min timeout
  return tempFile;
}

// Get Meta Ad title using yt-dlp
async function getMetaAdTitle(adId) {
  const proxyUrl = getProxyUrl();
  const cmd = `yt-dlp --proxy "${proxyUrl}" --no-check-certificates --get-title "https://www.facebook.com/ads/library/?id=${adId}"`;

  try {
    const { stdout } = await execAsync(cmd, { timeout: 30000 });
    return stdout.trim()
      .replace(/[<>:"/\\|?*]/g, '')
      .substring(0, 100) || `Meta Ad ${adId}`;
  } catch {
    return `Meta Ad ${adId}`;
  }
}

// Meta Ads transcript endpoint
app.post('/api/metaads/transcript', async (req, res) => {
  const { url, timestamps } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Meta Ad Library URL required' });
  }

  // Validate Meta Ad Library URL and extract ad ID
  const metaAdsRegex = /facebook\.com\/ads\/library\/?\?.*id=(\d+)/;
  const match = url.match(metaAdsRegex);

  if (!match) {
    return res.status(400).json({ error: 'Invalid Meta Ad Library URL. Expected format: https://www.facebook.com/ads/library/?id=XXXXXXXXX' });
  }

  const adId = match[1];
  console.log(`[API] Fetching Meta Ad transcript for ad ID: ${adId}`);

  // Check proxy config
  if (!DECODO_PROXY_USER || !DECODO_PROXY_PASS) {
    return res.status(500).json({ error: 'Proxy not configured for Meta Ads downloads' });
  }

  let tempFile = null;

  try {
    // 1. Download video using yt-dlp
    console.log(`[API] Downloading Meta Ad video: ${adId}`);
    tempFile = await downloadMetaAdVideo(adId);

    if (!existsSync(tempFile)) {
      throw new Error('Download completed but file not found');
    }

    // 2. Get ad title
    const title = await getMetaAdTitle(adId);
    console.log(`[API] Meta Ad title: ${title}`);

    // 3. Upload to AssemblyAI and transcribe
    console.log(`[API] Uploading to AssemblyAI...`);
    const uploadUrl = await assemblyai.files.upload(tempFile);
    console.log(`[API] Upload complete, submitting transcription...`);

    const transcriptRequest = await assemblyai.transcripts.submit({ audio_url: uploadUrl });

    // 4. Poll for completion
    let transcript;
    let pollCount = 0;
    while (true) {
      transcript = await assemblyai.transcripts.get(transcriptRequest.id);
      pollCount++;

      if (transcript.status === 'completed') {
        console.log(`[API] Transcription complete after ${pollCount} polls`);
        break;
      }
      if (transcript.status === 'error') {
        throw new Error(transcript.error || 'Transcription failed');
      }

      console.log(`[API] Transcription status: ${transcript.status} (poll ${pollCount})`);
      await new Promise(r => setTimeout(r, 3000));
    }

    // 5. Clean up temp file
    try { unlinkSync(tempFile); } catch {}

    // 6. Return result (same format as YouTube)
    const transcriptText = timestamps ? buildTimestampedTranscript(transcript.words) : transcript.text;
    res.json({
      transcript: transcriptText,
      adId: adId,
      title: title,
      source: 'metaads'
    });

  } catch (error) {
    console.error('[API] Meta Ads transcript error:', error);
    // Clean up temp file on error
    if (tempFile) {
      try { unlinkSync(tempFile); } catch {}
    }
    res.status(500).json({ error: error.message });
  }
});

// Video download job queue (in-memory)
const videoDownloadJobs = new Map();

// Clean up old jobs every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [jobId, job] of videoDownloadJobs) {
    // Remove jobs older than 30 minutes
    if (now - job.createdAt > 30 * 60 * 1000) {
      if (job.filePath && existsSync(job.filePath)) {
        try { unlinkSync(job.filePath); } catch (e) {}
      }
      videoDownloadJobs.delete(jobId);
    }
  }
}, 10 * 60 * 1000);

// Start video download job - returns immediately with job ID
app.post('/api/youtube/download-start/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const { isLive, duration } = req.body || {};

  if (!videoId || videoId.length !== 11) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

  if (!DECODO_PROXY_USER || !DECODO_PROXY_PASS) {
    return res.status(500).json({ error: 'Video download proxy not configured' });
  }

  const jobId = `dl_${videoId}_${Date.now()}`;
  const tempFile = join(__dirname, 'temp', `${jobId}.mp4`);

  // Create job entry
  videoDownloadJobs.set(jobId, {
    videoId,
    status: 'processing',
    filePath: tempFile,
    filename: `${videoId}.mp4`,
    createdAt: Date.now(),
    error: null
  });

  // Return job ID immediately
  res.json({ jobId });

  // Process download in background
  (async () => {
    const job = videoDownloadJobs.get(jobId);
    try {
      console.log(`[API] [${jobId}] Starting download for: ${videoId}${isLive ? ' (live stream)' : ''}`);

      const proxyUrl = getProxyUrl();
      const normalizedUrl = `https://www.youtube.com/watch?v=${videoId}`;
      console.log(`[API] [${jobId}] Using proxy: ${DECODO_PROXY_HOST}:${proxyUrl.match(/:(\d+)$/)?.[1] || 'unknown'}`);

      const startTime = Date.now();

      if (isLive) {
        // Live stream: get direct URL then record a clip with ffmpeg
        const liveDuration = Math.min(600, Math.max(30, parseInt(duration) || 120));
        console.log(`[API] [${jobId}] Recording ${liveDuration}s from live stream...`);

        const getUrlCmd = `yt-dlp --proxy "${proxyUrl}" --extractor-args "youtube:player_client=android" -f "best" -g --no-playlist --no-check-certificates "${normalizedUrl}"`;
        const { stdout: streamUrl } = await execAsync(getUrlCmd, { timeout: 60000 });
        const directUrl = streamUrl.trim().split('\n')[0];

        if (!directUrl) {
          throw new Error('Could not get live stream URL');
        }

        const ffmpegCmd = `ffmpeg -i "${directUrl}" -t ${liveDuration} -c copy "${tempFile}" -y`;
        const ffmpegTimeout = (liveDuration * 1.5 + 60) * 1000;
        await execAsync(ffmpegCmd, { timeout: ffmpegTimeout });
      } else {
        // Regular video: use yt-dlp to download
        const ytdlpCmd = `yt-dlp --proxy "${proxyUrl}" --extractor-args "youtube:player_client=android" -f "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 -o "${tempFile}" --no-playlist --no-check-certificates "${normalizedUrl}"`;
        await execAsync(ytdlpCmd, { timeout: 300000 });
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[API] [${jobId}] Download completed in ${elapsed}s`);

      if (!existsSync(tempFile)) {
        throw new Error('Download completed but file not found');
      }

      // Get video title for filename
      try {
        const titleCmd = `yt-dlp --proxy "${proxyUrl}" --extractor-args "youtube:player_client=android" --no-check-certificates --get-title "${normalizedUrl}"`;
        const { stdout } = await execAsync(titleCmd, { timeout: 30000 });
        const title = stdout.trim()
          .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
          .replace(/[<>:"/\\|?*#%&{}$!'`@=+]/g, '')
          .replace(/[^\x20-\x7E]/g, '')
          .trim()
          .substring(0, 100);
        if (title) job.filename = `${title}.mp4`;
      } catch (e) {
        console.log(`[API] [${jobId}] Could not get title:`, e.message);
      }

      const fsPromises = await import('fs/promises');
      const stats = await fsPromises.stat(tempFile);
      job.fileSize = stats.size;
      job.status = 'ready';
      console.log(`[API] [${jobId}] Ready: ${job.filename} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);

    } catch (error) {
      console.error(`[API] [${jobId}] Failed:`, error.message);
      job.status = 'failed';
      job.error = error.message;
      if (existsSync(tempFile)) {
        try { unlinkSync(tempFile); } catch (e) {}
      }
    }
  })();
});

// Check download job status
app.get('/api/youtube/download-status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = videoDownloadJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    status: job.status,
    filename: job.filename,
    fileSize: job.fileSize,
    error: job.error
  });
});

// Download ready file
app.get('/api/youtube/download-file/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = videoDownloadJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (job.status !== 'ready') {
    return res.status(400).json({ error: 'File not ready yet' });
  }

  if (!existsSync(job.filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${job.filename}"; filename*=UTF-8''${encodeURIComponent(job.filename)}`);
  res.setHeader('Content-Length', job.fileSize);

  const fileStream = createReadStream(job.filePath);

  fileStream.on('end', () => {
    console.log(`[API] [${jobId}] File sent successfully`);
    // Clean up
    try { unlinkSync(job.filePath); } catch (e) {}
    videoDownloadJobs.delete(jobId);
  });

  fileStream.on('error', (err) => {
    console.error(`[API] [${jobId}] Stream error:`, err.message);
  });

  fileStream.pipe(res);
});

// ==================== META ADS VIDEO DOWNLOAD ====================

// Start Meta Ad video download job - returns immediately with job ID
app.post('/api/metaads/download-start/:adId', async (req, res) => {
  const { adId } = req.params;

  if (!adId || !/^\d+$/.test(adId)) {
    return res.status(400).json({ error: 'Invalid ad ID' });
  }

  if (!DECODO_PROXY_USER || !DECODO_PROXY_PASS) {
    return res.status(500).json({ error: 'Video download proxy not configured' });
  }

  const jobId = `dl_metaad_${adId}_${Date.now()}`;
  const tempDir = join(__dirname, 'temp');
  if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
  const tempFile = join(tempDir, `${jobId}.mp4`);

  // Create job entry
  videoDownloadJobs.set(jobId, {
    adId,
    status: 'processing',
    filePath: tempFile,
    filename: `Meta Ad ${adId}.mp4`,
    createdAt: Date.now(),
    error: null
  });

  // Return job ID immediately
  res.json({ jobId });

  // Process download in background
  (async () => {
    const job = videoDownloadJobs.get(jobId);
    try {
      console.log(`[API] [${jobId}] Starting download for Meta Ad: ${adId}`);

      const proxyUrl = getProxyUrl();
      console.log(`[API] [${jobId}] Using proxy: ${DECODO_PROXY_HOST}:${proxyUrl.match(/:(\d+)$/)?.[1] || 'unknown'}`);

      const ytdlpCmd = `yt-dlp --proxy "${proxyUrl}" -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 -o "${tempFile}" --no-playlist --no-check-certificates "https://www.facebook.com/ads/library/?id=${adId}"`;

      const startTime = Date.now();
      await execAsync(ytdlpCmd, { timeout: 300000 });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[API] [${jobId}] yt-dlp completed in ${elapsed}s`);

      if (!existsSync(tempFile)) {
        throw new Error('Download completed but file not found');
      }

      // Get ad title for filename
      try {
        const title = await getMetaAdTitle(adId);
        if (title && title !== `Meta Ad ${adId}`) {
          const safeTitle = title
            .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
            .replace(/[<>:"/\\|?*#%&{}$!'`@=+]/g, '')
            .replace(/[^\x20-\x7E]/g, '')
            .trim()
            .substring(0, 100);
          if (safeTitle) job.filename = `${safeTitle}.mp4`;
        }
      } catch (e) {
        console.log(`[API] [${jobId}] Could not get title:`, e.message);
      }

      const fsPromises = await import('fs/promises');
      const stats = await fsPromises.stat(tempFile);
      job.fileSize = stats.size;
      job.status = 'ready';
      console.log(`[API] [${jobId}] Ready: ${job.filename} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);

    } catch (error) {
      console.error(`[API] [${jobId}] Failed:`, error.message);
      job.status = 'failed';
      job.error = error.message;
      if (existsSync(tempFile)) {
        try { unlinkSync(tempFile); } catch (e) {}
      }
    }
  })();
});

// Check Meta Ad download job status
app.get('/api/metaads/download-status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = videoDownloadJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    status: job.status,
    filename: job.filename,
    fileSize: job.fileSize,
    error: job.error
  });
});

// Download ready Meta Ad file
app.get('/api/metaads/download-file/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = videoDownloadJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (job.status !== 'ready') {
    return res.status(400).json({ error: 'File not ready yet' });
  }

  if (!existsSync(job.filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${job.filename}"; filename*=UTF-8''${encodeURIComponent(job.filename)}`);
  res.setHeader('Content-Length', job.fileSize);

  const fileStream = createReadStream(job.filePath);

  fileStream.on('end', () => {
    console.log(`[API] [${jobId}] File sent successfully`);
    // Clean up
    try { unlinkSync(job.filePath); } catch (e) {}
    videoDownloadJobs.delete(jobId);
  });

  fileStream.on('error', (err) => {
    console.error(`[API] [${jobId}] Stream error:`, err.message);
  });

  fileStream.pipe(res);
});

// Legacy download endpoint (kept for backwards compatibility with clips)
app.get('/api/youtube/download/:videoId', async (req, res) => {
  const { videoId } = req.params;

  if (!videoId || videoId.length !== 11) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

  if (!DECODO_PROXY_USER || !DECODO_PROXY_PASS) {
    return res.status(500).json({ error: 'Video download proxy not configured' });
  }

  const tempFile = join(__dirname, 'temp', `${videoId}_${Date.now()}.mp4`);

  try {
    console.log(`[API] Downloading video via yt-dlp: ${videoId}`);

    const proxyUrl = getProxyUrl();
    console.log(`[API] Using proxy: ${DECODO_PROXY_HOST}:${proxyUrl.match(/:(\d+)$/)?.[1] || 'unknown'}`);

    const ytdlpCmd = `yt-dlp --proxy "${proxyUrl}" --extractor-args "youtube:player_client=android" -f "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 -o "${tempFile}" --no-playlist --no-check-certificates "https://www.youtube.com/watch?v=${videoId}"`;

    console.log('[API] Running yt-dlp...');
    const startTime = Date.now();
    await execAsync(ytdlpCmd, { timeout: 300000 });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[API] yt-dlp completed in ${elapsed}s`);

    if (!existsSync(tempFile)) {
      throw new Error('Download completed but file not found');
    }

    let filename = `${videoId}.mp4`;
    try {
      const titleCmd = `yt-dlp --proxy "${proxyUrl}" --get-title "https://www.youtube.com/watch?v=${videoId}"`;
      const { stdout } = await execAsync(titleCmd, { timeout: 30000 });
      const title = stdout.trim()
        .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
        .replace(/[<>:"/\\|?*#%&{}$!'`@=+]/g, '')
        .replace(/[^\x20-\x7E]/g, '')
        .trim()
        .substring(0, 100);
      if (title) filename = `${title}.mp4`;
    } catch (e) {
      console.log('[API] Could not get title:', e.message);
    }

    const fsPromises = await import('fs/promises');
    const stats = await fsPromises.stat(tempFile);
    console.log(`[API] Video file size: ${(stats.size / 1024 / 1024).toFixed(1)}MB`);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Length', stats.size);

    const fileStream = createReadStream(tempFile);

    fileStream.on('end', () => {
      console.log(`[API] Stream complete: ${filename}`);
      try { unlinkSync(tempFile); } catch (e) {}
    });

    fileStream.on('error', (err) => {
      console.error('[API] Stream error:', err.message);
      try { unlinkSync(tempFile); } catch (e) {}
    });

    fileStream.pipe(res);

  } catch (error) {
    console.error('[API] yt-dlp download error:', error.message);
    // Clean up temp file on error
    try { unlinkSync(tempFile); } catch (e) {}
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to download video: ' + error.message });
    }
  }
});

// Create server with extended timeout for large uploads
const server = app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Queue limits: Global=${CONFIG.MAX_GLOBAL_CONCURRENT}, Per-user=${CONFIG.MAX_USER_CONCURRENT}, Queue=${CONFIG.MAX_USER_QUEUE}`);
});

// Increase timeout to 10 minutes for large file uploads
server.timeout = 600000;
server.keepAliveTimeout = 600000;
server.headersTimeout = 600000;
