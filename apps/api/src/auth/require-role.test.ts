import express from 'express';
import request from 'supertest';
import { describe, it } from 'vitest';
import { requireRole } from './require-role.js';

function createTestApp(role?: 'ADMIN' | 'MONITOR' | 'RESPONDER') {
  const app = express();

  // Simulate the user that requireAuth normally supplies.
  app.use((_request, response, next) => {
    if (role) {
      response.locals.user = { id: 'test-user', role };
    }
    next();
  });

  app.get('/admin-only', requireRole('ADMIN'), (_request, response) => {
    response.sendStatus(204);
  });

  app.get(
    '/monitoring',
    requireRole('ADMIN', 'MONITOR'),
    (_request, response) => {
      response.sendStatus(204);
    },
  );

  return app;
}

describe('role authorization', () => {
  it('allows an Admin to access an Admin-only route', async () => {
    await request(createTestApp('ADMIN'))
      .get('/admin-only')
      .expect(204);
  });

  it('denies a Monitor access to an Admin-only route', async () => {
    await request(createTestApp('MONITOR'))
      .get('/admin-only')
      .expect(403);
  });

  it('denies a Responder access to an Admin-only route', async () => {
    await request(createTestApp('RESPONDER'))
      .get('/admin-only')
      .expect(403);
  });

  it('rejects a request without an authenticated user', async () => {
    await request(createTestApp())
      .get('/admin-only')
      .expect(401);
  });

  it.each(['ADMIN', 'MONITOR'] as const)(
    'allows %s to access monitoring',
    async (role) => {
      await request(createTestApp(role))
        .get('/monitoring')
        .expect(204);
    },
  );

  it('denies a Responder access to monitoring', async () => {
    await request(createTestApp('RESPONDER'))
      .get('/monitoring')
      .expect(403);
  });
});