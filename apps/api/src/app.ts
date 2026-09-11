import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { authRouter } from './auth/auth.routes.js';
import { deviceRouter } from './devices/device.routes.js';
import { monitoringRouter } from './monitoring/monitoring-event.routes.js';
import { eventRouter } from './monitoring/event.route.js';
import { deviceGroupRouter } from './device-groups/device-group.routes.js';
import { responderRouter } from './responders/responder.routes.js';
import { auditRouter } from './audit/audit.routes.js';
import { userRouter } from './users/user.routes.js';
import cookieParser from 'cookie-parser';
import { validateMutationOrigin, loginAttemptLimiter } from './auth/request-protection.js';

export function createApp(checkDatabase: () => Promise<void>, webRoot?: string) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', validateMutationOrigin);
  const limitAuth = loginAttemptLimiter();
  app.use(['/api/auth/login', '/api/auth/reauthenticate'], limitAuth);

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  app.use('/api/devices', deviceRouter);
  app.use('/api', monitoringRouter);
  app.use('/api/events', eventRouter);
  app.use('/api/device-groups', deviceGroupRouter);
  app.use('/api/responders', responderRouter);
  app.use('/api/audit-logs', auditRouter);
  app.use('/api/users', userRouter);

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
    if (
      (error && error.type === 'entity.too.large')
      || (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE')
    ) {
      response.status(413).json({
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the size limit.' },
      });
      return;
    }
    if (error instanceof multer.MulterError) {
      response.status(400).json({
        error: { code: 'INVALID_SNAPSHOT', message: 'Provide one JPEG snapshot.' },
      });
      return;
    }
    response.status(badJson ? 400 : 500).json({
      error: { code: badJson ? 'INVALID_JSON' : 'INTERNAL_ERROR', message: badJson ? 'Invalid JSON body.' : 'Request failed.' },
    });
  };
  app.use(errorHandler);
  return app;
}
