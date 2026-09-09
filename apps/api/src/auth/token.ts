import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config.js';

export const SESSION_DURATION_SECONDS = 8 * 60 * 60; // 8 hours

const claimsSchema = z.object({
  sub: z.string().uuid(),
  sessionId: z.string().uuid(),
  exp: z.number().int(),
});

export function createToken(
  userId: string,
  sessionId: string,
  expiresAt: Date,
): string {
  return jwt.sign(
    {
      sessionId,
      exp: Math.floor(expiresAt.getTime() / 1000),
    },
    env.JWT_SECRET,
    {
      algorithm: 'HS256',
      subject: userId,
      issuer: 'cammon-api',
      audience: 'cammon-web',
    },
  );
}

export function verifyToken(token: string) {
  const decoded = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: 'cammon-api',
    audience: 'cammon-web',
  });

  return claimsSchema.parse(decoded);
}