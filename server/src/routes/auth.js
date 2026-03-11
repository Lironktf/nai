import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { supabase } from '../db/supabase.js';
import { signToken } from '../lib/jwt.js';

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  legalName: z.string().min(1).max(120).optional(),
  phone: z.string().max(30).optional(),
});

function generateUserCode() {
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
}

// POST /auth/register
// Creates a user with status 'pending_kyc' and returns a JWT.
router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { email, password, legalName, phone } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 12);

  // Generate a unique 5-char code, retry on collision (extremely rare).
  let user, error;
  for (let attempt = 0; attempt < 5; attempt++) {
    const userCode = generateUserCode();
    const insert = { email, password_hash: passwordHash, status: 'pending_kyc', user_code: userCode };
    if (legalName) insert.legal_name = legalName;
    if (phone) insert.phone = phone;
    ({ data: user, error } = await supabase
      .from('users')
      .insert(insert)
      .select('id, email, status, user_code')
      .single());
    if (!error) break;
    if (error.code !== '23505' || error.message?.includes('email')) break; // real dupe email error
  }

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    console.error('Register DB error:', error);
    return res.status(500).json({ error: 'Registration failed' });
  }

  await supabase.from('audit_logs').insert({
    user_id: user.id,
    event_type: 'USER_REGISTERED',
    ip_address: req.ip,
    user_agent: req.headers['user-agent'],
  });

  const token = signToken({ userId: user.id, email: user.email, isAdmin: false });
  return res.status(201).json({ token, user });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// POST /auth/login
// Returns a JWT. Works for both regular users and admins.
router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { email, password } = parsed.data;

  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, password_hash, status, is_admin')
    .eq('email', email)
    .single();

  if (error || !user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = signToken({ userId: user.id, email: user.email, isAdmin: user.is_admin });
  return res.json({ token, user: { id: user.id, email: user.email, status: user.status, isAdmin: user.is_admin } });
});

export default router;
