import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/stats/:userId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM stats WHERE user_id = $1', [req.params.userId]);
    res.json(result.rows[0] || { total_translations: 0, total_words_saved: 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dashboard/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const stats = await pool.query('SELECT * FROM stats WHERE user_id = $1', [userId]);
    const topWords = await pool.query('SELECT word, translation, frequency FROM saved_words WHERE user_id = $1 ORDER BY frequency DESC LIMIT 10', [userId]);
    const recent = await pool.query('SELECT original_text, translated_text, created_at FROM translations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10', [userId]);
    
    res.json({
      stats: stats.rows[0] || { total_translations: 0, total_words_saved: 0 },
      topWords: topWords.rows,
      recentTranslations: recent.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  res.send('<html><body><h1>Dashboard</h1><p>API is working</p></body></html>');
});

app.listen(PORT, () => {
  console.log('Dashboard running on port ' + PORT);
});
