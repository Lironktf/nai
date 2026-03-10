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

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDist = join(__dirname, '..', '..', 'client', 'dist');

const app = express();
// Trust the first proxy (ngrok / reverse proxy) so express-rate-limit
// reads the real client IP from X-Forwarded-For instead of erroring.
app.set('trust proxy', 1);
const httpServer = createServer(app);

const CORS_ORIGINS = [
  process.env.CLIENT_URL || 'http://localhost:5173',
  process.env.MOBILE_ORIGIN,
].filter(Boolean);

export const io = new SocketServer(httpServer, {
  cors: {
    origin: CORS_ORIGINS,
    methods: ['GET', 'POST'],
  },
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));

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

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth', authRouter);
app.use('/kyc', kycRouter);
app.use('/enroll', enrollRouter);
app.use('/admin', adminRouter);
app.use('/mobile', mobileRouter);

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
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, async () => {
  console.log(`TrustHandshake server running on port ${PORT}`);
});
