import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import { createReadStream, unlinkSync, mkdirSync, existsSync } from 'fs';
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
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/wav', 'audio/mp4'];
    cb(null, allowed.includes(file.mimetype));
  }
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(express.static(join(__dirname, 'public')));
app.use(express.json());

// Transcribe uploaded video
app.post('/api/transcribe', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded' });
  }

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: createReadStream(req.file.path),
      model: 'whisper-1',
      response_format: 'text'
    });

    // Clean up uploaded file
    unlinkSync(req.file.path);

    res.json({
      filename: req.file.originalname,
      transcription
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

// Summarize transcription with custom prompt
app.post('/api/summarize', async (req, res) => {
  const { transcription, prompt } = req.body;

  if (!transcription || !prompt) {
    return res.status(400).json({ error: 'Transcription and prompt required' });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that processes video transcriptions according to user instructions. Format your output clearly with markdown.'
        },
        {
          role: 'user',
          content: `Here is a video transcription:\n\n${transcription}\n\n---\n\n${prompt}`
        }
      ]
    });

    res.json({ summary: completion.choices[0].message.content });
  } catch (error) {
    console.error('Summarization error:', error);
    res.status(500).json({ error: 'Summarization failed: ' + error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
