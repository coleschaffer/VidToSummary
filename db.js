import pg from 'pg';
const { Pool } = pg;

let pool = null;
let dbConnected = false;

// Only create pool if DATABASE_URL is set
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
}

// Initialize database tables
export async function initDb() {
  if (!pool) {
    console.warn('DATABASE_URL not set, skipping database initialization');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS videos (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(500) NOT NULL,
        file_size BIGINT,
        mime_type VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS transcripts (
        id SERIAL PRIMARY KEY,
        video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
        transcript_text TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS summaries (
        id SERIAL PRIMARY KEY,
        prompt TEXT,
        summary_text TEXT,
        video_ids INTEGER[],
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    dbConnected = true;
    console.log('Database tables initialized');
  } finally {
    client.release();
  }
}

// Video operations
export async function saveVideo(filename, fileSize, mimeType) {
  if (!dbConnected) {
    console.log('[DB] Skipping saveVideo - no database');
    return null;
  }
  try {
    const result = await pool.query(
      'INSERT INTO videos (filename, file_size, mime_type) VALUES ($1, $2, $3) RETURNING id',
      [filename, fileSize, mimeType]
    );
    return result.rows[0].id;
  } catch (err) {
    console.error('[DB] saveVideo error:', err.message);
    return null;
  }
}

export async function getVideos() {
  if (!dbConnected) return [];
  try {
    const result = await pool.query(`
      SELECT v.*, t.transcript_text
      FROM videos v
      LEFT JOIN transcripts t ON v.id = t.video_id
      ORDER BY v.created_at DESC
    `);
    return result.rows;
  } catch (err) {
    console.error('[DB] getVideos error:', err.message);
    return [];
  }
}

// Transcript operations
export async function saveTranscript(videoId, transcriptText) {
  if (!dbConnected || !videoId) {
    console.log('[DB] Skipping saveTranscript - no database or videoId');
    return;
  }
  try {
    await pool.query(
      'INSERT INTO transcripts (video_id, transcript_text) VALUES ($1, $2)',
      [videoId, transcriptText]
    );
  } catch (err) {
    console.error('[DB] saveTranscript error:', err.message);
  }
}

export async function getTranscript(videoId) {
  if (!dbConnected) return null;
  try {
    const result = await pool.query(
      'SELECT transcript_text FROM transcripts WHERE video_id = $1',
      [videoId]
    );
    return result.rows[0]?.transcript_text;
  } catch (err) {
    console.error('[DB] getTranscript error:', err.message);
    return null;
  }
}

// Summary operations
export async function saveSummary(prompt, summaryText, videoIds) {
  if (!dbConnected) {
    console.log('[DB] Skipping saveSummary - no database');
    return null;
  }
  try {
    const result = await pool.query(
      'INSERT INTO summaries (prompt, summary_text, video_ids) VALUES ($1, $2, $3) RETURNING id',
      [prompt, summaryText, videoIds]
    );
    return result.rows[0].id;
  } catch (err) {
    console.error('[DB] saveSummary error:', err.message);
    return null;
  }
}

export async function getSummaries() {
  if (!dbConnected) return [];
  try {
    const result = await pool.query('SELECT * FROM summaries ORDER BY created_at DESC');
    return result.rows;
  } catch (err) {
    console.error('[DB] getSummaries error:', err.message);
    return [];
  }
}

// Stats
export async function getStats() {
  if (!dbConnected) {
    return { totalVideos: 0, totalTranscripts: 0, totalSummaries: 0 };
  }
  try {
    const videos = await pool.query('SELECT COUNT(*) as count FROM videos');
    const transcripts = await pool.query('SELECT COUNT(*) as count FROM transcripts');
    const summaries = await pool.query('SELECT COUNT(*) as count FROM summaries');

    return {
      totalVideos: parseInt(videos.rows[0].count),
      totalTranscripts: parseInt(transcripts.rows[0].count),
      totalSummaries: parseInt(summaries.rows[0].count)
    };
  } catch (err) {
    console.error('[DB] getStats error:', err.message);
    return { totalVideos: 0, totalTranscripts: 0, totalSummaries: 0 };
  }
}

export default pool;
