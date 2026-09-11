import { expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

it('rejects cross-origin mutations before processing credentials', async () => {
  const app = createApp(async () => {});
  await request(app).post('/api/auth/login')
    .set('Origin','https://untrusted.invalid').send({}).expect(403);
});

it('returns 413 for oversized JSON rather than a server error', async () => {
  const app = createApp(async () => {});
  await request(app).post('/api/auth/login')
    .send({password:'x'.repeat(110_000)}).expect(413);
});

it('limits repeated login attempts and provides retry timing', async () => {
  const app = createApp(async () => {});
  for (let i=0; i<60; i++) await request(app).post('/api/auth/login').send({}).expect(400);
  const result = await request(app).post('/api/auth/login').send({}).expect(429);
  expect(Number(result.headers['retry-after'])).toBeGreaterThan(0);
});
