import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { supabase } from '../db/supabase.js';
import { signToken } from '../lib/jwt.js';

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

// POST /auth/register
// Creates a user with status 'pending_kyc' and returns a JWT.
router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 12);

  const { data: user, error } = await supabase
    .from('users')
    .insert({ email, password_hash: passwordHash, status: 'pending_kyc' })
    .select('id, email, status')
    .single();

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

export default router;
