import type { Request, Response, NextFunction } from 'express';
import * as Sentry from '@sentry/node';
import { ZodError } from 'zod';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = crypto.randomUUID();

  // Request-validation failures are client errors, not server errors: no 500,
  // no Sentry noise.
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Invalid request',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      requestId,
    });
    return;
  }

  // Postgres 22P02 (invalid text representation) = a malformed UUID/enum in a
  // path or body param reached a query — client error, not an outage.
  if ((err as unknown as { code?: string }).code === '22P02') {
    res.status(400).json({ error: 'Invalid identifier', requestId });
    return;
  }

  console.error(`[${requestId}] Unhandled error:`, err);

  // Report to Sentry with request context. Deliberately NOT the body: it can
  // carry PII (date_of_birth, coach messages, capture manifests).
  Sentry.withScope((scope) => {
    scope.setTag('requestId', requestId);
    scope.setExtra('method', req.method);
    scope.setExtra('url', req.originalUrl);
    Sentry.captureException(err);
  });

  const statusCode = (err as unknown as { statusCode?: number }).statusCode ?? 500;
  const message = statusCode === 500 ? 'Internal server error' : err.message;

  res.status(statusCode).json({
    error: message,
    requestId,
  });
}
