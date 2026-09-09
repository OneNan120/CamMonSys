import { Router } from 'express';
import { z } from 'zod';
import { authenticateUser } from './auth.service.js';
import { createLoginSession, revokeLoginSession} from './session.service.js';
import { env } from '../config.js';
import { requireAuth } from './require-auth.js';


export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

authRouter.post('/login', async (request, response) => {
  const parsed = loginSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({
      error: {
        code: 'INVALID_INPUT',
        message: 'Provide a valid email and password.',
      },
    });
    return;
  }

  const user = await authenticateUser(
    parsed.data.email,
    parsed.data.password,
  );

  if (!user) {
    response.status(401).json({
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      },
    });
    return;
  }

    const { token, expiresAt } = await createLoginSession(user.id);

    response.cookie('cammon_token', token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
    });

    response.json({ user });
});

authRouter.get('/me', requireAuth, (_request, response) => {
  response.json({ user: response.locals.user });
});

authRouter.post(
  '/logout',
  requireAuth,
  async (_request, response) => {
    await revokeLoginSession(response.locals.sessionId);

    response.clearCookie('cammon_token', {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    response.status(204).send();
  },
);