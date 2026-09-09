import type { RequestHandler } from 'express';

type Role = 'ADMIN' | 'MONITOR' | 'RESPONDER';

export function requireRole(...allowedRoles: Role[]): RequestHandler {
  return (_request, response, next) => {
    const user = response.locals.user;

    if (!user) {
      response.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Please sign in.',
        },
      });
      return;
    }

    if (!allowedRoles.includes(user.role)) {
      response.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to perform this action.',
        },
      });
      return;
    }

    next();
  };
}