import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database tables
export async function initDb() {
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

    console.log('Database tables initialized');
  } finally {
    client.release();
  }
}

// Video operations
export async function saveVideo(filename, fileSize, mimeType) {
  const result = await pool.query(
    'INSERT INTO videos (filename, file_size, mime_type) VALUES ($1, $2, $3) RETURNING id',
    [filename, fileSize, mimeType]
  );
  return result.rows[0].id;
}

export async function getVideos() {
  const result = await pool.query(`
    SELECT v.*, t.transcript_text
    FROM videos v
    LEFT JOIN transcripts t ON v.id = t.video_id
    ORDER BY v.created_at DESC
  `);
  return result.rows;
}

// Transcript operations
export async function saveTranscript(videoId, transcriptText) {
  await pool.query(
    'INSERT INTO transcripts (video_id, transcript_text) VALUES ($1, $2)',
    [videoId, transcriptText]
  );
}

export async function getTranscript(videoId) {
  const result = await pool.query(
    'SELECT transcript_text FROM transcripts WHERE video_id = $1',
    [videoId]
  );
  return result.rows[0]?.transcript_text;
}

// Summary operations
export async function saveSummary(prompt, summaryText, videoIds) {
  const result = await pool.query(
    'INSERT INTO summaries (prompt, summary_text, video_ids) VALUES ($1, $2, $3) RETURNING id',
    [prompt, summaryText, videoIds]
  );
  return result.rows[0].id;
}

export async function getSummaries() {
  const result = await pool.query('SELECT * FROM summaries ORDER BY created_at DESC');
  return result.rows;
}

// Stats
export async function getStats() {
  const videos = await pool.query('SELECT COUNT(*) as count FROM videos');
  const transcripts = await pool.query('SELECT COUNT(*) as count FROM transcripts');
  const summaries = await pool.query('SELECT COUNT(*) as count FROM summaries');

  return {
    totalVideos: parseInt(videos.rows[0].count),
    totalTranscripts: parseInt(transcripts.rows[0].count),
    totalSummaries: parseInt(summaries.rows[0].count)
  };
}

export default pool;
