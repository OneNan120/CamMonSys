import { Router } from 'express';
import { requireAuth } from '../auth/require-auth.js';
import { requireRole } from '../auth/require-role.js';
import { listResponders } from './responder.service.js';

export const responderRouter = Router();

responderRouter.get(
  '/',
  requireAuth,
  requireRole('ADMIN', 'MONITOR'),
  async (_request, response) => {
    const responders = await listResponders();
    response.json({ responders });
  },
);   