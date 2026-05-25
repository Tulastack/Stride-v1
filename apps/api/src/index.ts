import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import * as Sentry from '@sentry/node';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

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
import agentRouter from './routes/agent.js';
import calendarRouter from './routes/calendar.js';
import usersRouter from './routes/users.js';
import internalRouter from './routes/internal.js';
import consentRouter from './routes/consent.js';

import { pool } from './db/queries.js';
import { checkS3Health } from './lib/s3.js';
import { checkSQSHealth } from './lib/sqs.js';
import { startSweepJob, stopSweepJob } from './lib/sweep.js';
import { errorHandler } from './middleware/errors.js';
import type { HealthCheckResult } from './types.js';

const app = express();
const port = process.env.PORT || 3000;

// Security and utility middlewares
app.use(helmet());
app.use(cors({
  origin: '*', // Adjust in production to restrict to mobile app deep links/origins if necessary
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Internal-Token'],
  exposedHeaders: ['ETag'],
}));
app.use(express.json());

// Routes
app.use('/videos', videosRouter);
app.use('/agent', agentRouter);
app.use('/calendar', calendarRouter);
app.use('/users', usersRouter);
app.use('/consent', consentRouter);
app.use('/internal', internalRouter);

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

// Start Server
const server = app.listen(port, () => {
  console.log(`[Stride API] Server listening on port ${port} (Express 5)`);
  
  // Start the stuck analysis cron sweeper
  startSweepJob();
});

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`[Stride API] Received ${signal}. Shutting down gracefully...`);
  
  stopSweepJob();

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
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
