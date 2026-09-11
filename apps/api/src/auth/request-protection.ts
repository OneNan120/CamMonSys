import type { RequestHandler } from 'express';
import { env } from '../config.js';

export const validateMutationOrigin: RequestHandler = (request, response, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
  const origin = request.get('origin');
  const allowed = new Set([
    env.APP_ORIGIN,
    `${request.protocol}://${request.get('host')}`,
    ...(env.NODE_ENV !== 'production' ? ['http://localhost:5173'] : []),
  ]);
  if (request.get('sec-fetch-site') === 'cross-site' || (origin && !allowed.has(origin))) {
    response.status(403).json({
      error: { code: 'INVALID_ORIGIN', message: 'This request origin is not allowed.' },
    });
    return;
  }
  next();
};

export function loginAttemptLimiter(): RequestHandler {
  const attempts = new Map<string, { count: number; until: number }>();
  return (request, response, next) => {
    const now = Date.now();
    for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
    const key = request.ip ?? 'unknown';
    const entry = attempts.get(key) ?? { count: 0, until: now + 15 * 60_000 };
    entry.count++;
    attempts.set(key, entry);
    if (entry.count > 60) {
      response.set('Retry-After', String(Math.ceil((entry.until - now) / 1000)));
      response.status(429).json({
        error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many sign-in attempts. Try again later.' },
      });
      return;
    }
    next();
  };
}
