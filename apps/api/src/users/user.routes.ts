import { Router } from 'express';

import { z } from 'zod';

import { requireAuth } from '../auth/require-auth.js';
import { requireRole } from '../auth/require-role.js';
import { createUser, listUsers } from './user.service.js';

export const userRouter = Router();

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().email().max(320),
    password: z.string().min(12).max(1024),
    role: z.enum(['ADMIN', 'MONITOR', 'RESPONDER']),
  })
  .strict();

userRouter.use(requireAuth, requireRole('ADMIN'));

userRouter.get('/', async (_request, response) =>
  response.json({
    users: await listUsers(),
  }),
);

userRouter.post('/', async (request, response) => {
  const parsed = createSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({
      error: {
        code: 'INVALID_INPUT',
        message:
          'Provide a valid name, email, role, and password of at least 12 characters.',
      },
    });

    return;
  }

  try {
    const user = await createUser(
      parsed.data,
      response.locals.user.id,
    );

    response.status(201).json({ user });
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    ) {
      response.status(409).json({
        error: {
          code: 'EMAIL_CONFLICT',
          message: 'An account with this email already exists.',
        },
      });

      return;
    }

    throw error;
  }
});