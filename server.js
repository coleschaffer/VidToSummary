import express from 'express';
import multer from 'multer';
import { AssemblyAI } from 'assemblyai';
import Anthropic from '@anthropic-ai/sdk';
import { unlinkSync, mkdirSync, existsSync } from 'fs';
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

// RapidAPI for YouTube video downloads
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

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

    console.log(`[API] Splitting into ${chunks.length} chunks for translation`);

    const translatedChunks = [];
    for (let i = 0; i < chunks.length; i++) {
      console.log(`[API] Translating chunk ${i + 1}/${chunks.length}`);

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: `Translate the following transcript segment from ${sourceLang} to English. This is part ${i + 1} of ${chunks.length}. Provide only the translated text, maintaining the original formatting. Do not add any explanations, notes, or segment markers.

Transcript segment:
${chunks[i]}`
        }]
      });

      translatedChunks.push(response.content[0].text);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[API] Translation complete in ${elapsed}s (${chunks.length} chunks)`);

    return translatedChunks.join(' ');
  } catch (error) {
    console.error('[API] Translation error:', error.message);
    // Return original text if translation fails
    return text;
  }
}

// Fetch transcript from Supadata with language preference
async function fetchSupadataTranscript(url, lang) {
  const supadataUrl = `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(url)}&text=true&lang=${lang}`;
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
        return { content: pollData.content, lang: pollData.lang };
      } else if (pollData.status === 'failed') {
        throw new Error('Supadata transcription failed');
      }
      pollCount++;
    }
    throw new Error('Transcript polling timed out');
  }

  // Handle errors
  if (!response.ok) {
    if (response.status === 206) throw new Error('No transcript available for this video');
    if (response.status === 404) throw new Error('Video not found or is private');
    if (response.status === 403) throw new Error('Video requires authentication or is restricted');
    throw new Error(`Supadata API error: ${response.status}`);
  }

  const data = await response.json();
  return { content: data.content, lang: data.lang };
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

  console.log(`\n[API] ========== Starting job ${jobId}: ${filename} (${fileSize}MB) [User: ${sessionId}] ==========`);

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
      startTime: Date.now()
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

    // Save transcript to database
    await saveTranscript(job.videoId, transcript.text);

    // Mark complete
    job.status = 'completed';
    job.stage = 'done';
    job.progress = 100;
    job.transcription = transcript.text;

    // Update queue manager
    completeJob(jobId, { transcription: transcript.text });

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

// YouTube transcript via Supadata API
app.post('/api/youtube/transcript', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'YouTube URL required' });
  }

  if (!SUPADATA_API_KEY) {
    return res.status(500).json({ error: 'Supadata API key not configured' });
  }

  // Validate YouTube URL
  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|v\/)|youtu\.be\/)[\w-]+/;
  if (!youtubeRegex.test(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  console.log(`[API] Fetching YouTube transcript for: ${url}`);

  try {
    // Try to get English transcript (en first, then en-US fallback)
    let result;

    // First try with 'en'
    console.log('[API] Trying transcript with lang=en');
    result = await fetchSupadataTranscript(url, 'en');
    console.log(`[API] Got transcript: ${result.content?.length || 0} chars, lang: ${result.lang}`);

    // If not English, try en-US as fallback
    if (result.lang && !result.lang.startsWith('en')) {
      console.log('[API] Not English, trying lang=en-US fallback');
      try {
        const fallbackResult = await fetchSupadataTranscript(url, 'en-US');
        if (fallbackResult.lang?.startsWith('en')) {
          result = fallbackResult;
          console.log(`[API] en-US fallback successful: ${result.content?.length || 0} chars`);
        } else {
          console.log(`[API] en-US fallback also returned ${fallbackResult.lang}, will translate`);
        }
      } catch (e) {
        console.log(`[API] en-US fallback failed: ${e.message}, will translate original`);
      }
    }

    // Extract video ID and fetch title
    const videoId = url.match(/(?:v=|youtu\.be\/)([^&\s]+)/)?.[1] || 'video';
    let title = videoId;

    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const oembedResponse = await fetch(oembedUrl);
      if (oembedResponse.ok) {
        const oembedData = await oembedResponse.json();
        title = oembedData.title || videoId;
      }
    } catch (e) {
      console.log(`[API] Could not fetch video title: ${e.message}`);
    }

    // Translate to English if still not in English
    let transcript = result.content;
    if (result.lang && !result.lang.startsWith('en')) {
      console.log(`[API] Translating transcript from ${result.lang} to English`);
      transcript = await translateToEnglish(transcript, result.lang);
    }

    res.json({
      transcript: transcript,
      lang: 'en',
      videoId: videoId,
      title: title,
      source: 'youtube'
    });
  } catch (error) {
    console.error('[API] YouTube transcript error:', error);
    res.status(500).json({ error: error.message });
  }
});

// YouTube video download endpoint - uses RapidAPI YouTube Media Downloader
app.get('/api/youtube/download/:videoId', async (req, res) => {
  const { videoId } = req.params;

  if (!videoId || videoId.length !== 11) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

  if (!RAPIDAPI_KEY) {
    return res.status(500).json({ error: 'Video download service not configured' });
  }

  try {
    console.log(`[API] Requesting video download for: ${videoId}`);

    // Get video details from RapidAPI
    const apiUrl = `https://youtube-media-downloader.p.rapidapi.com/v2/video/details?videoId=${videoId}`;
    const apiResponse = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'x-rapidapi-host': 'youtube-media-downloader.p.rapidapi.com',
        'x-rapidapi-key': RAPIDAPI_KEY
      }
    });

    if (!apiResponse.ok) {
      throw new Error(`RapidAPI error: ${apiResponse.status}`);
    }

    const data = await apiResponse.json();
    console.log('[API] RapidAPI response received for:', videoId);

    // Find a suitable video format (prefer 720p mp4)
    let downloadUrl;
    let filename = `${videoId}.mp4`;

    if (data.videos?.items && data.videos.items.length > 0) {
      // Look for 720p first, then fall back to other qualities
      const video = data.videos.items.find(v => v.quality === '720p' && v.extension === 'mp4')
        || data.videos.items.find(v => v.extension === 'mp4')
        || data.videos.items[0];

      downloadUrl = video.url;
      if (data.title) {
        const safeTitle = data.title.replace(/[<>:"/\\|?*]/g, '').substring(0, 100);
        filename = `${safeTitle}.${video.extension || 'mp4'}`;
      }
    }

    if (!downloadUrl) {
      return res.status(404).json({ error: 'No download URL available for this video' });
    }

    console.log('[API] Proxying video download for:', videoId);

    // Fetch the video and proxy it through our server
    const videoResponse = await fetch(downloadUrl);

    if (!videoResponse.ok) {
      throw new Error(`Failed to fetch video: ${videoResponse.status}`);
    }

    // Set response headers
    res.setHeader('Content-Type', videoResponse.headers.get('content-type') || 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (videoResponse.headers.get('content-length')) {
      res.setHeader('Content-Length', videoResponse.headers.get('content-length'));
    }

    // Stream the video to the client
    const nodeStream = await import('stream');
    const readable = nodeStream.Readable.fromWeb(videoResponse.body);
    readable.pipe(res);

  } catch (error) {
    console.error('[API] YouTube download error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to download video. Please try again.' });
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
