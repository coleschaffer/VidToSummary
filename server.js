import express from 'express';
import multer from 'multer';
import { AssemblyAI } from 'assemblyai';
import Anthropic from '@anthropic-ai/sdk';
import { unlinkSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

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

// Transcribe uploaded video using AssemblyAI
app.post('/api/transcribe', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded' });
  }

  try {
    console.log(`Transcribing: ${req.file.originalname}`);

    const transcript = await assemblyai.transcripts.transcribe({
      audio: req.file.path
    });

    // Clean up uploaded file
    unlinkSync(req.file.path);

    if (transcript.status === 'error') {
      throw new Error(transcript.error || 'Transcription failed');
    }

    res.json({
      filename: req.file.originalname,
      transcription: transcript.text
    });
  } catch (error) {
    console.error('Transcription error:', error);
    // Clean up on error
    if (req.file?.path) {
      try { unlinkSync(req.file.path); } catch {}
    }
    res.status(500).json({ error: 'Transcription failed: ' + error.message });
  }
});

// Summarize transcription with custom prompt using Claude Opus 4.5
app.post('/api/summarize', async (req, res) => {
  const { transcription, prompt } = req.body;

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

    res.json({ summary: message.content[0].text });
  } catch (error) {
    console.error('Summarization error:', error);
    res.status(500).json({ error: 'Summarization failed: ' + error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
