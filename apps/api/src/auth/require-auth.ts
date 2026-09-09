import type { RequestHandler } from 'express';
import { pool } from '../db.js';
import { verifyToken } from './token.js';

type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'MONITOR' | 'RESPONDER';
};

export const requireAuth: RequestHandler = async (
  request,
  response,
  next,
) => {
  const unauthorized = () => {
    response.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Please sign in.',
      },
    });
  };

  const token = request.cookies?.cammon_token;

  if (typeof token !== 'string' || !token) {
    unauthorized();
    return;
  }

  let claims: ReturnType<typeof verifyToken>;

  try {
    claims = verifyToken(token);
  } catch {
    unauthorized();
    return;
  }

  const result = await pool.query<AuthUser>(
    `SELECT u.id, u.name, u.email, u.role
     FROM auth_sessions AS s
     JOIN users AS u ON u.id = s.user_id
     WHERE s.id = $1
       AND s.user_id = $2
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()`,
    [claims.sessionId, claims.sub],
  );

  const user = result.rows[0];

  if (!user) {
    unauthorized();
    return;
  }

  response.locals.user = user;
  response.locals.sessionId = claims.sessionId;

  next();
};