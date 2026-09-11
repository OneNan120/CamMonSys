import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import { listAuditLogs, listAuditLogFilterOptions } from './audit.service.js';

export const auditRouter = Router();

const listAuditQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(100),
    search: z.string().trim().max(100).optional(),
    actorId: z.string().uuid().optional(),
    action: z.string().trim().min(1).max(100).optional(),
    targetType: z.string().trim().min(1).max(100).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    sort: z.enum(['newest', 'oldest']).default('newest'),
  })
  .refine(
    (query) =>
      !query.from ||
      !query.to ||
      new Date(query.from).getTime() <=
        new Date(query.to).getTime(),
    {
      message: 'The start time must not be after the end time.',
      path: ['from'],
    },
  );

auditRouter.get(
  '/filter-options',
  requireAuth,
  async (_request, response) => {
    const user = response.locals.user;
    const options = await listAuditLogFilterOptions(
      user.role === 'ADMIN' ? undefined : user.id,
    );
    response.json(options);
  },
);

auditRouter.get(
  '/',
  requireAuth,
  async (request, response) => {
    const parsed = listAuditQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Provide valid audit-log filters.',
        },
      });
      return;
    }

    const user = response.locals.user;
    const auditLogs = await listAuditLogs({
      limit: parsed.data.limit,
      search: parsed.data.search || undefined,
      actorId: user.role === 'ADMIN' ? parsed.data.actorId : user.id,
      action: parsed.data.action,
      targetType: parsed.data.targetType,
      from: parsed.data.from,
      to: parsed.data.to,
      sort: parsed.data.sort,
    });
    response.json({ auditLogs });
  },
);