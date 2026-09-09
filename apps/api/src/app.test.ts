import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';

describe('environment health', () => {
  it('reports database connectivity', async () => {
    const response = await request(createApp(async () => {})).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', database: 'connected' });
  });
  it('returns unavailable without exposing database errors', async () => {
    const response = await request(createApp(async () => { throw new Error('private connection details'); })).get('/api/health');
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('private');
  });
  it('returns JSON for unknown APIs', async () => {
    const response = await request(createApp(async () => {})).get('/api/missing');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
