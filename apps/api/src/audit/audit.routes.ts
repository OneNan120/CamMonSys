import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import { requireRole } from '../auth/require-role.js';
import { listAuditLogs } from './audit.service.js';

export const auditRouter = Router();

const listAuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

auditRouter.get(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  async (request, response) => {
    const parsed = listAuditQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Limit must be an integer between 1 and 200.',
        },
      });
      return;
    }

    const auditLogs = await listAuditLogs(parsed.data.limit);
    response.json({ auditLogs });
  },
);