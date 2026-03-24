import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import axios from 'axios';
import Tesseract from 'tesseract.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb' }));

// Initialize database
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS translations (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255),
        original_text TEXT NOT NULL,
        translated_text TEXT NOT NULL,
        source_lang VARCHAR(10),
        target_lang VARCHAR(10),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS saved_words (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255),
        word TEXT NOT NULL,
        translation TEXT NOT NULL,
        language VARCHAR(10),
        frequency INT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS stats (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) UNIQUE,
        total_translations INT DEFAULT 0,
        total_words_saved INT DEFAULT 0,
        last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_translations_user ON translations(user_id);
      CREATE INDEX IF NOT EXISTS idx_saved_words_user ON saved_words(user_id);
    `);
    console.log('✅ Database initialized');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Translate text
app.post('/api/translate', async (req, res) => {
  try {
    const { text, sourceLang = 'en', targetLang = 'ar', userId } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Call LibreTranslate API
    const response = await axios.post('https://libretranslate.de/translate', {
      q: text,
      source: sourceLang,
      target: targetLang,
    });

    const translatedText = response.data.translatedText;

    // Save to database
    if (userId) {
      await pool.query(
        `INSERT INTO translations (user_id, original_text, translated_text, source_lang, target_lang)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, text, translatedText, sourceLang, targetLang]
      );

      // Update stats
      await pool.query(
        `INSERT INTO stats (user_id, total_translations) VALUES ($1, 1)
         ON CONFLICT (user_id) DO UPDATE SET 
         total_translations = total_translations + 1,
         updated_at = CURRENT_TIMESTAMP`,
        [userId]
      );
    }

    res.json({
      original: text,
      translated: translatedText,
      sourceLang,
      targetLang,
    });
  } catch (error) {
    console.error('Translation error:', error);
    res.status(500).json({ error: 'Translation failed' });
  }
});

// Translate image
app.post('/api/translate-image', async (req, res) => {
  try {
    const { imageBase64, sourceLang = 'en', targetLang = 'ar', userId } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'Image is required' });
    }

    // Extract text from image using Tesseract
    const result = await Tesseract.recognize(imageBase64, 'eng');
    const extractedText = result.data.text;

    // Translate extracted text
    const translateResponse = await axios.post('https://libretranslate.de/translate', {
      q: extractedText,
      source: sourceLang,
      target: targetLang,
    });

    const translatedText = translateResponse.data.translatedText;

    // Save to database
    if (userId) {
      await pool.query(
        `INSERT INTO translations (user_id, original_text, translated_text, source_lang, target_lang)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, extractedText, translatedText, sourceLang, targetLang]
      );
    }

    res.json({
      extracted: extractedText,
      translated: translatedText,
      sourceLang,
      targetLang,
    });
  } catch (error) {
    console.error('Image translation error:', error);
    res.status(500).json({ error: 'Image translation failed' });
  }
});

// Save word
app.post('/api/save-word', async (req, res) => {
  try {
    const { word, translation, language = 'ar', userId } = req.body;

    if (!word || !translation) {
      return res.status(400).json({ error: 'Word and translation are required' });
    }

    await pool.query(
      `INSERT INTO saved_words (user_id, word, translation, language)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, word) DO UPDATE SET frequency = frequency + 1`,
      [userId, word, translation, language]
    );

    // Update stats
    await pool.query(
      `INSERT INTO stats (user_id, total_words_saved) VALUES ($1, 1)
       ON CONFLICT (user_id) DO UPDATE SET 
       total_words_saved = total_words_saved + 1,
       updated_at = CURRENT_TIMESTAMP`,
      [userId]
    );

    res.json({ success: true, message: 'Word saved' });
  } catch (error) {
    console.error('Save word error:', error);
    res.status(500).json({ error: 'Failed to save word' });
  }
});

// Get saved words
app.get('/api/saved-words/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      `SELECT * FROM saved_words WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get saved words error:', error);
    res.status(500).json({ error: 'Failed to fetch saved words' });
  }
});

// Get translation history
app.get('/api/translations/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      `SELECT * FROM translations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get translations error:', error);
    res.status(500).json({ error: 'Failed to fetch translations' });
  }
});

// Get stats
app.get('/api/stats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      `SELECT * FROM stats WHERE user_id = $1`,
      [userId]
    );
    res.json(result.rows[0] || { total_translations: 0, total_words_saved: 0 });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Start server
app.listen(PORT, async () => {
  await initDatabase();
  console.log(`🚀 Server running on port ${PORT}`);
});
