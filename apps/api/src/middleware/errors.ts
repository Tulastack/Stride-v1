import type { Request, Response, NextFunction } from 'express';
import * as Sentry from '@sentry/node';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = crypto.randomUUID();

  console.error(`[${requestId}] Unhandled error:`, err);

  // Report to Sentry with request context
  Sentry.withScope((scope) => {
    scope.setTag('requestId', requestId);
    scope.setExtra('method', req.method);
    scope.setExtra('url', req.originalUrl);
    scope.setExtra('body', req.body);
    Sentry.captureException(err);
  });

  const statusCode = (err as unknown as { statusCode?: number }).statusCode ?? 500;
  const message = statusCode === 500 ? 'Internal server error' : err.message;

  res.status(statusCode).json({
    error: message,
    requestId,
  });
}
