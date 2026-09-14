import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcrypt';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import memoryRoutes from './routes/memories.js';
import { auth } from './middleware/auth.js';

dotenv.config();
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));
fs.mkdirSync(uploadDir, { recursive: true });

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.get('/api/health', (_, res) => res.json({ ok: true, service: 'AK — Forever Love' }));

async function ensureTwoUsers() {
  const seed = [
    ['ak', 'Forever@123', 'AK'],
    ['forever', 'Love@123', 'Forever']
  ];
  for (const [username, password, displayName] of seed) {
    const exists = await poolQuery('SELECT id FROM users WHERE username=$1', [username]);
    if (!exists.rowCount) {
      const hash = await bcrypt.hash(password, 12);
      await poolQuery(
        'INSERT INTO users(username,password_hash,display_name) VALUES($1,$2,$3)',
        [username, hash, displayName]
      );
    }
  }
}
async function poolQuery(text, params) {
  const { pool } = await import('./db.js');
  return pool.query(text, params);
}
await ensureTwoUsers();
app.use('/api/auth', authRoutes);
app.use('/api/memories', auth, memoryRoutes);
app.use('/uploads', auth, express.static(uploadDir, { fallthrough: false }));

app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: 'File is too large.' });
  res.status(err.status || 500).json({ message: err.message || 'Server error.' });
});

const port = Number(process.env.PORT || 5000);
app.listen(port, () => console.log(`AK Forever Love API listening on ${port}`));
