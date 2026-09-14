import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';

const router = Router();

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: 'Username and password are required.' });
    const { rows } = await pool.query('SELECT id, username, display_name, password_hash FROM users WHERE username=$1', [username]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, displayName: user.display_name },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, username: user.username, displayName: user.display_name } });
  } catch (e) { next(e); }
});

router.get('/me', async (req, res) => res.status(401).json({ message: 'Use the protected app routes.' }));

export default router;
