import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as Sentry from '@sentry/node';

// ─── Boot-time env validation ──────────────────────────────────────
// Fail fast with a readable message instead of a cryptic crash at first
// request (missing SUPABASE_URL throws TypeError: Invalid URL deep in auth).
{
  const missing: string[] = [];
  if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.INTERNAL_API_SECRET) missing.push('INTERNAL_API_SECRET');
    if ((process.env.STORAGE_DRIVER ?? 's3').toLowerCase() !== 'local') {
      if (!process.env.S3_BUCKET) missing.push('S3_BUCKET');
      if (!process.env.SQS_QUEUE_URL) missing.push('SQS_QUEUE_URL');
    }
  }
  if (missing.length > 0) {
    console.error(`[Stride API] Refusing to start — missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// Initialize Sentry first (if DSN is configured)
const sentryDsn = process.env.SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 1.0,
  });
}

import videosRouter from './routes/videos.js';
import calendarRouter from './routes/calendar.js';
import usersRouter from './routes/users.js';
import internalRouter from './routes/internal.js';
import consentRouter from './routes/consent.js';
import coachSessionsRouter from './routes/coachSessions.js';
import suggestionsRouter from './routes/suggestions.js';
import referenceDrillsRouter from './routes/referenceDrills.js';
import metricsRouter from './routes/metrics.js';
import analysesProgressRouter from './routes/analyses.js';

import { pool } from './db/queries.js';
import { checkS3Health } from './lib/s3.js';
import { checkSQSHealth } from './lib/sqs.js';
import { startSweepJob, stopSweepJob } from './lib/sweep.js';
import { startSessionSweepJob, stopSessionSweepJob } from './lib/sessionSweep.js';
import { errorHandler } from './middleware/errors.js';
import type { HealthCheckResult } from './types.js';

const app = express();
const port = process.env.PORT || 3000;

// Behind the ALB: trust one proxy hop so req.ip (rate limiting) is the client.
app.set('trust proxy', 1);

// Security and utility middlewares
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*', // Set CORS_ORIGIN in production if needed
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Internal-Token'],
  exposedHeaders: ['ETag'],
}));

// JSON body limits: 1 MB for client routes; 50 MB for /internal, whose
// worker callbacks carry full result payloads (per-frame 3D poses on the
// wham path blow straight through the express default of 100 KB).
const jsonClient = express.json({ limit: '1mb' });
const jsonInternal = express.json({ limit: '50mb' });
app.use((req, res, next) =>
  req.path.startsWith('/internal') ? jsonInternal(req, res, next) : jsonClient(req, res, next),
);

// Rate limiting: a broad safety net for everything, plus a tight budget for
// the coach (each message costs up to 5 Groq round-trips).
const globalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || req.path.startsWith('/internal'),
});
const coachLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many coach messages — take a breather and try again in a few minutes.' },
});
app.use(globalLimiter);
app.use('/coach-sessions', coachLimiter);

// Routes
app.use('/videos', videosRouter);
// NOTE: the open-ended /agent chat route was removed (PRD v2.2 F.5 vision
// retention: no free-text coaching stream, no conversations table).
app.use('/calendar', calendarRouter);
app.use('/users', usersRouter);
app.use('/consent', consentRouter);
app.use('/internal', internalRouter);
app.use('/coach-sessions', coachSessionsRouter);
app.use('/suggestions', suggestionsRouter);
app.use('/analyses', suggestionsRouter); // handles /analyses/:analysisId/suggestions
app.use('/analyses', analysesProgressRouter); // handles /analyses/:analysisId/progress (SSE)
app.use('/reference-drills', referenceDrillsRouter);
app.use('/users', metricsRouter);  // mounts at /users/me/metrics

/**
 * Health check endpoint verifying all critical external integrations
 */
app.get('/health', async (_req, res) => {
  let dbStatus: 'ok' | 'error' = 'ok';
  let s3Status: 'ok' | 'error' = 'ok';
  let sqsStatus: 'ok' | 'error' = 'ok';

  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error('Healthcheck DB error:', err);
    dbStatus = 'error';
  }

  const s3Ok = await checkS3Health();
  if (!s3Ok) s3Status = 'error';

  const sqsOk = await checkSQSHealth();
  if (!sqsOk) sqsStatus = 'error';

  const isOk = dbStatus === 'ok' && s3Status === 'ok' && sqsStatus === 'ok';

  const result: HealthCheckResult = {
    status: isOk ? 'ok' : 'error',
    components: {
      database: dbStatus,
      s3: s3Status,
      sqs: sqsStatus,
    },
    timestamp: new Date().toISOString(),
  };

  res.status(isOk ? 200 : 500).json(result);
});

// Root path fallback
app.get('/', (_req, res) => {
  res.json({ message: 'Stride API is running.' });
});

// Error handling middleware
app.use(errorHandler);

// Start Server — bind 0.0.0.0 so phones on the LAN can reach the API
// (default Node bind is sometimes loopback-only depending on env/platform).
const host = process.env.HOST ?? '0.0.0.0';
const server = app.listen(Number(port), host, () => {
  console.log(`[Stride API] Server listening on http://${host}:${port} (Express 5)`);
  
  // Start the stuck analysis cron sweeper
  startSweepJob();
  // Start the inactive session sealer (every hour)
  startSessionSweepJob();
});

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`[Stride API] Received ${signal}. Shutting down gracefully...`);

  stopSweepJob();
  stopSessionSweepJob();

  server.close(async () => {
    console.log('[Stride API] HTTP server closed.');
    try {
      await pool.end();
      console.log('[Stride API] Database connection pool terminated.');
      process.exit(0);
    } catch (err) {
      console.error('[Stride API] Error shutting down DB pool:', err);
      process.exit(1);
    }
  });

  // Long-lived SSE connections (15s heartbeats) keep server.close() waiting
  // forever — drop them so the close callback can actually run, and hard-exit
  // as a backstop if something still hangs.
  setTimeout(() => server.closeAllConnections(), 2_000).unref();
  setTimeout(() => {
    console.error('[Stride API] Forced exit after shutdown timeout.');
    process.exit(1);
  }, 15_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
