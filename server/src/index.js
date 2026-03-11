import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import authRouter from './routes/auth.js';
import kycRouter from './routes/kyc.js';
import enrollRouter from './routes/enroll.js';
import adminRouter from './routes/admin.js';
import mobileRouter from './routes/mobile.js';
import telegramRouter from './routes/telegram.js';
import meetRouter from './routes/meet.js';
import { supabase } from './db/supabase.js';


const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDist = join(__dirname, '..', '..', 'client', 'dist');

const app = express();
// Trust the first proxy (ngrok / reverse proxy) so express-rate-limit
// reads the real client IP from X-Forwarded-For instead of erroring.
app.set('trust proxy', 1);
const httpServer = createServer(app);

const CORS_ORIGINS = [
  process.env.CLIENT_URL || 'http://localhost:5173',
  process.env.MEET_URL || 'http://localhost:5174',
  process.env.MOBILE_ORIGIN,
].filter(Boolean);

function corsOrigin(origin, callback) {
  if (!origin) return callback(null, true); // native/mobile/non-browser requests
  if (CORS_ORIGINS.includes(origin)) return callback(null, true);
  return callback(new Error('Not allowed by CORS'));
}

export const io = new SocketServer(httpServer, {
  cors: {
    origin: CORS_ORIGINS,
    methods: ['GET', 'POST'],
  },
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet({
  // Allow Google Meet to embed /meet-panel in an iframe
  frameguard: false,
  contentSecurityPolicy: false,
}));
app.use(cors({ origin: corsOrigin }));

// Raw body MUST be registered before express.json().
// The webhook route needs the raw Buffer to verify Persona's HMAC signature.
app.use('/kyc/webhook', express.raw({ type: '*/*' }));
// 10 MB limit to accommodate base64-encoded camera frames for face verification.
app.use(express.json({ limit: '10mb' }));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Apple App Site Association (passkeys / universal links) ───────────────────
// iOS requires this file to verify the app-domain association before creating
// a passkey. The bundle ID must match app.json's ios.bundleIdentifier.
// Replace XXXXXXXXXX with your 10-character Apple Developer Team ID.
app.get('/.well-known/apple-app-site-association', (_req, res) => {
  const teamId = process.env.APPLE_TEAM_ID;
  if (!teamId) {
    console.warn('[AASA] APPLE_TEAM_ID env var not set — passkey domain verification will fail on real devices');
  }
  const bundleId = process.env.APP_BUNDLE_ID || 'com.trusthandshake.app';
  res.setHeader('Content-Type', 'application/json');
  res.json({
    webcredentials: {
      apps: teamId ? [`${teamId}.${bundleId}`] : [],
    },
  });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth', authRouter);
app.use('/kyc', kycRouter);
app.use('/enroll', enrollRouter);
app.use('/admin', adminRouter);
app.use('/mobile', mobileRouter);
app.use('/telegram', telegramRouter);
app.use('/meet', meetRouter);

// ── Liveness page (built client static files) ─────────────────────────────────
// The mobile WebView opens /liveness?sessionId=...&identityPoolId=...&region=...
// Serve the pre-built React client bundle from client/dist.
// Run `npm run build` in the client/ directory before using this.
if (existsSync(clientDist)) {
  app.use('/assets', express.static(join(clientDist, 'assets')));
  app.get('/liveness', (_req, res) => res.sendFile(join(clientDist, 'index.html')));
} else {
  app.get('/liveness', (_req, res) =>
    res.status(503).send('Liveness page not built. Run: cd client && npm run build')
  );
}

// ── Meet side panel (built meet app static files) ─────────────────────────────
// Google Meet add-on loads /meet-panel in the side panel iframe.
// Run `npm run build` in the meet/ directory before using this.
const meetDist = join(__dirname, '..', '..', 'meet', 'dist');
if (existsSync(meetDist)) {
  app.use('/meet-panel/assets', express.static(join(meetDist, 'assets')));
  app.get('/meet-panel', (_req, res) => res.sendFile(join(meetDist, 'index.html')));
} else {
  app.get('/meet-panel', (_req, res) =>
    res.status(503).send('Meet panel not built. Run: cd meet && npm run build')
  );
}

// ── Socket.io auth gate ───────────────────────────────────────────────────────
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.user?.userId;
  console.log(`Socket connected: ${socket.id} (user ${userId})`);
  // Join a private room keyed by userId so mobile.js can emit targeted events.
  if (userId) socket.join(userId);

  // Meet side-panel: subscribe host/participant to meeting session room.
  socket.on('meeting:join', async ({ sessionId }, ack) => {
    try {
      if (!sessionId) {
        ack?.({ ok: false, error: 'Missing sessionId' });
        return;
      }

      const { data: session } = await supabase
        .from('meeting_sessions')
        .select('id, host_user_id')
        .eq('id', sessionId)
        .single();

      if (!session) {
        ack?.({ ok: false, error: 'Session not found' });
        return;
      }

      let allowed = session.host_user_id === userId;
      if (!allowed) {
        const { data: participant } = await supabase
          .from('meeting_participants')
          .select('id')
          .eq('meeting_session_id', sessionId)
          .eq('nai_user_id', userId)
          .maybeSingle();
        allowed = Boolean(participant);
      }

      if (!allowed) {
        ack?.({ ok: false, error: 'Forbidden for this meeting room' });
        return;
      }

      socket.join(`meeting:${sessionId}`);
      ack?.({ ok: true });
    } catch (err) {
      console.error('[socket meeting:join] error:', err.message);
      ack?.({ ok: false, error: 'Failed to join room' });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, async () => {
  console.log(`TrustHandshake server running on port ${PORT}`);
});
