import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Get user stats
app.get('/api/stats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      `SELECT * FROM stats WHERE user_id = $1`,
      [userId]
    );
    res.json(result.rows[0] || { 
      total_translations: 0, 
      total_words_saved: 0,
      last_used: new Date()
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get saved words with pagination
app.get('/api/saved-words/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const result = await pool.query(
      `SELECT * FROM saved_words 
       WHERE user_id = $1 
       ORDER BY frequency DESC, created_at DESC 
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM saved_words WHERE user_id = $1`,
      [userId]
    );

    res.json({
      words: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    console.error('Get saved words error:', error);
    res.status(500).json({ error: 'Failed to fetch saved words' });
  }
});

// Get translation history
app.get('/api/translations/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const result = await pool.query(
      `SELECT * FROM translations 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM translations WHERE user_id = $1`,
      [userId]
    );

    res.json({
      translations: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    console.error('Get translations error:', error);
    res.status(500).json({ error: 'Failed to fetch translations' });
  }
});

// Get dashboard overview
app.get('/api/dashboard/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Get stats
    const statsResult = await pool.query(
      `SELECT * FROM stats WHERE user_id = $1`,
      [userId]
    );

    // Get top saved words
    const topWordsResult = await pool.query(
      `SELECT word, translation, frequency FROM saved_words 
       WHERE user_id = $1 
       ORDER BY frequency DESC 
       LIMIT 10`,
      [userId]
    );

    // Get recent translations
    const recentResult = await pool.query(
      `SELECT original_text, translated_text, created_at FROM translations 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 10`,
      [userId]
    );

    // Get language stats
    const langStatsResult = await pool.query(
      `SELECT target_lang, COUNT(*) as count FROM translations 
       WHERE user_id = $1 
       GROUP BY target_lang`,
      [userId]
    );

    res.json({
      stats: statsResult.rows[0] || { 
        total_translations: 0, 
        total_words_saved: 0 
      },
      topWords: topWordsResult.rows,
      recentTranslations: recentResult.rows,
      languageStats: langStatsResult.rows,
    });
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Delete saved word
app.delete('/api/saved-words/:userId/:wordId', async (req, res) => {
  try {
    const { userId, wordId } = req.params;
    await pool.query(
      `DELETE FROM saved_words WHERE id = $1 AND user_id = $2`,
      [wordId, userId]
    );
    res.json({ success: true, message: 'Word deleted' });
  } catch (error) {
    console.error('Delete word error:', error);
    res.status(500).json({ error: 'Failed to delete word' });
  }
});

// Clear all translations for user
app.delete('/api/translations/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    await pool.query(
      `DELETE FROM translations WHERE user_id = $1`,
      [userId]
    );
    res.json({ success: true, message: 'Translations cleared' });
  } catch (error) {
    console.error('Clear translations error:', error);
    res.status(500).json({ error: 'Failed to clear translations' });
  }
});

// Serve dashboard HTML
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>لوحة التحكم - مترجم Chrome</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          padding: 20px;
        }
        
        .container {
          max-width: 1200px;
          margin: 0 auto;
        }
        
        header {
          background: white;
          padding: 30px;
          border-radius: 10px;
          margin-bottom: 30px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        }
        
        h1 {
          color: #333;
          margin-bottom: 10px;
        }
        
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }
        
        .stat-card {
          background: white;
          padding: 25px;
          border-radius: 10px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.1);
          text-align: center;
        }
        
        .stat-card h3 {
          color: #667eea;
          font-size: 14px;
          margin-bottom: 10px;
          text-transform: uppercase;
        }
        
        .stat-card .number {
          font-size: 36px;
          font-weight: bold;
          color: #333;
        }
        
        .section {
          background: white;
          padding: 25px;
          border-radius: 10px;
          margin-bottom: 20px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        
        .section h2 {
          color: #333;
          margin-bottom: 20px;
          border-bottom: 2px solid #667eea;
          padding-bottom: 10px;
        }
        
        table {
          width: 100%;
          border-collapse: collapse;
        }
        
        th {
          background: #f5f5f5;
          padding: 12px;
          text-align: right;
          color: #333;
          font-weight: 600;
        }
        
        td {
          padding: 12px;
          border-bottom: 1px solid #eee;
        }
        
        tr:hover {
          background: #f9f9f9;
        }
        
        .btn {
          background: #667eea;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 5px;
          cursor: pointer;
          font-size: 14px;
        }
        
        .btn:hover {
          background: #764ba2;
        }
        
        .btn-danger {
          background: #e74c3c;
        }
        
        .btn-danger:hover {
          background: #c0392b;
        }
        
        .loading {
          text-align: center;
          padding: 40px;
          color: #667eea;
        }
        
        .error {
          background: #fee;
          color: #c33;
          padding: 15px;
          border-radius: 5px;
          margin-bottom: 20px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <header>
          <h1>📊 لوحة التحكم - مترجم Chrome</h1>
          <p>أدخل معرف المستخدم لعرض الإحصائيات</p>
          <input type="text" id="userId" placeholder="معرف المستخدم" style="padding: 10px; margin-top: 10px; width: 100%; max-width: 300px; border: 1px solid #ddd; border-radius: 5px;">
          <button class="btn" onclick="loadDashboard()" style="margin-top: 10px;">تحميل</button>
        </header>
        
        <div id="content"></div>
      </div>
      
      <script>
        async function loadDashboard() {
          const userId = document.getElementById('userId').value;
          if (!userId) {
            alert('أدخل معرف المستخدم');
            return;
          }
          
          const content = document.getElementById('content');
          content.innerHTML = '<div class="loading">جاري التحميل...</div>';
          
          try {
            const response = await fetch(\`/api/dashboard/\${userId}\`);
            const data = await response.json();
            
            let html = \`
              <div class="stats-grid">
                <div class="stat-card">
                  <h3>إجمالي الترجمات</h3>
                  <div class="number">\${data.stats.total_translations || 0}</div>
                </div>
                <div class="stat-card">
                  <h3>الكلمات المحفوظة</h3>
                  <div class="number">\${data.stats.total_words_saved || 0}</div>
                </div>
              </div>
              
              <div class="section">
                <h2>🔝 أكثر الكلمات استخداماً</h2>
                <table>
                  <thead>
                    <tr>
                      <th>الكلمة</th>
                      <th>الترجمة</th>
                      <th>عدد المرات</th>
                    </tr>
                  </thead>
                  <tbody>
            \`;
            
            data.topWords.forEach(word => {
              html += \`
                <tr>
                  <td>\${word.word}</td>
                  <td>\${word.translation}</td>
                  <td>\${word.frequency}</td>
                </tr>
              \`;
            });
            
            html += \`
                  </tbody>
                </table>
              </div>
              
              <div class="section">
                <h2>📝 آخر الترجمات</h2>
                <table>
                  <thead>
                    <tr>
                      <th>النص الأصلي</th>
                      <th>الترجمة</th>
                      <th>التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
            \`;
            
            data.recentTranslations.forEach(trans => {
              const date = new Date(trans.created_at).toLocaleDateString('ar-SA');
              html += \`
                <tr>
                  <td>\${trans.original_text.substring(0, 50)}</td>
                  <td>\${trans.translated_text.substring(0, 50)}</td>
                  <td>\${date}</td>
                </tr>
              \`;
            });
            
            html += \`
                  </tbody>
                </table>
              </div>
            \`;
            
            content.innerHTML = html;
          } catch (error) {
            content.innerHTML = \`<div class="error">خطأ: \${error.message}</div>\`;
          }
        }
      </script>
    </body>
    </html>
  `);
});

// Start server
app.listen(PORT, () => {
  console.log(\`🎨 Dashboard running on port \${PORT}\`);
});
