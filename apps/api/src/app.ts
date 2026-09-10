import express, { type ErrorRequestHandler } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { authRouter } from './auth/auth.routes.js';
import { deviceRouter } from './devices/device.routes.js';
import { monitoringRouter } from './monitoring/monitoring.routes.js';
import cookieParser from 'cookie-parser';

export function createApp(checkDatabase: () => Promise<void>, webRoot?: string) {
  const app = express();
  app.disable('x-powered-by');

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  app.use('/api/devices', deviceRouter);
  app.use('/api', monitoringRouter);


  app.get('/api/health', async (_request, response) => {
    try {
      await checkDatabase();
      response.json({ status: 'ok', database: 'connected' });
    } catch {
      response.status(503).json({ status: 'unavailable', database: 'disconnected' });
    }
  });
  app.use('/api', (_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'API endpoint not found.' } });
  });
  if (webRoot && existsSync(resolve(webRoot, 'index.html'))) {
    app.use(express.static(webRoot));
    app.get('/{*path}', (_request, response) => response.sendFile(resolve(webRoot, 'index.html')));
  }
  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    const badJson = error instanceof SyntaxError && 'body' in error;
    response.status(badJson ? 400 : 500).json({
      error: { code: badJson ? 'INVALID_JSON' : 'INTERNAL_ERROR', message: badJson ? 'Invalid JSON body.' : 'Request failed.' },
    });
  };
  app.use(errorHandler);
  return app;
}
