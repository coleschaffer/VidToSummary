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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '2323';

// Initialize database
initDb().catch(console.error);

// Ensure uploads directory exists
const uploadsDir = join(__dirname, 'uploads');
if (!existsSync(uploadsDir)) {
  mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for video uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/x-m4a'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// AssemblyAI for transcription
const assemblyai = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });

// Anthropic for summarization (Claude Opus 4.5)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.static(join(__dirname, 'public')));
app.use(express.json());
app.use(cookieParser());

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
    const stats = await getStats();
    res.json(stats);
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

// Track video IDs for current session (for linking summaries)
let currentSessionVideoIds = [];

// Transcribe uploaded video using AssemblyAI
app.post('/api/transcribe', upload.single('video'), async (req, res) => {
  const startTime = Date.now();

  if (!req.file) {
    console.log('[API] No file in request');
    return res.status(400).json({ error: 'No video file uploaded' });
  }

  const filename = req.file.originalname;
  const fileSize = (req.file.size / (1024 * 1024)).toFixed(1);
  console.log(`\n[API] ========== Received: ${filename} (${fileSize}MB) ==========`);

  try {
    // Save video to database
    console.log(`[API] [${filename}] Saving to database...`);
    const videoId = await saveVideo(
      req.file.originalname,
      req.file.size,
      req.file.mimetype
    );
    currentSessionVideoIds.push(videoId);
    console.log(`[API] [${filename}] Saved to DB with ID: ${videoId}`);

    // Upload and transcribe with AssemblyAI
    console.log(`[API] [${filename}] Starting AssemblyAI transcription...`);
    console.log(`[API] [${filename}] File path: ${req.file.path}`);
    const transcribeStart = Date.now();

    const transcript = await assemblyai.transcripts.transcribe({
      audio: req.file.path
    });

    const transcribeTime = ((Date.now() - transcribeStart) / 1000).toFixed(1);
    console.log(`[API] [${filename}] AssemblyAI returned after ${transcribeTime}s`);
    console.log(`[API] [${filename}] Status: ${transcript.status}`);
    if (transcript.id) console.log(`[API] [${filename}] Transcript ID: ${transcript.id}`);

    // Clean up uploaded file
    unlinkSync(req.file.path);
    console.log(`[API] [${filename}] Cleaned up temp file`);

    if (transcript.status === 'error') {
      console.error(`[API] [${filename}] AssemblyAI error:`, transcript.error);
      throw new Error(transcript.error || 'Transcription failed');
    }

    // Save transcript to database
    console.log(`[API] [${filename}] Saving transcript to DB (${transcript.text?.length || 0} chars)...`);
    await saveTranscript(videoId, transcript.text);

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[API] [${filename}] ✓ COMPLETE! Total time: ${totalTime}s`);

    res.json({
      filename: req.file.originalname,
      transcription: transcript.text,
      videoId
    });
  } catch (error) {
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[API] [${filename}] ✗ FAILED after ${totalTime}s:`, error.message);
    console.error(`[API] [${filename}] Full error:`, error);
    // Clean up on error
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
      model: 'claude-opus-4-5-20250514',
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
    const idsToSave = videoIds || currentSessionVideoIds;
    if (idsToSave.length > 0) {
      await saveSummary(prompt, summaryText, idsToSave);
    }

    res.json({ summary: summaryText });
  } catch (error) {
    console.error('Summarization error:', error);
    res.status(500).json({ error: 'Summarization failed: ' + error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
