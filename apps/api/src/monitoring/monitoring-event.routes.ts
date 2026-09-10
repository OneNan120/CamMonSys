import { Router } from 'express';
import { pool } from '../db.js';
import { env } from '../config.js';
import { requireAuth } from '../auth/require-auth.js';
import { requireRole } from '../auth/require-role.js';
import { subscribeToDeviceChanges, subscribeToEventChanges } from './monitoring-events.js';

export const monitoringRouter = Router();

monitoringRouter.get(
  '/stream',
  requireAuth,
  requireRole('ADMIN', 'MONITOR', 'RESPONDER'),
  (_request, response) => {
    const sessionId = response.locals.sessionId;
    const userId = response.locals.user.id;

    response.status(200);
    response.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();

    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe = () => {};
    let unsubscribeEvents = () => {};

    function cleanup() {
      if (closed) return;

      closed = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      unsubscribeEvents();
    }

    function closeConnection() {
      cleanup();
      response.end();
    }

    function write(message: string) {
      if (closed || response.destroyed) return;

      // Disconnect slow clients instead of buffering indefinitely.
      // Reconnection will trigger a fresh REST fetch.
      if (!response.write(message)) {
        closeConnection();
      }
    }

    async function checkSession() {
      try {
        const result = await pool.query(
          `SELECT s.id
           FROM auth_sessions AS s
           JOIN users AS u ON u.id = s.user_id
           WHERE s.id = $1
             AND s.user_id = $2
             AND s.revoked_at IS NULL
             AND s.expires_at > NOW()
             AND u.role IN ('ADMIN', 'MONITOR', 'RESPONDER')`,
          [sessionId, userId],
        );

        if (closed) return;

        if (result.rowCount !== 1) {
          write('event: access-ended\ndata: {}\n\n');
          closeConnection();
          return;
        }

        // SSE comments keep the connection active without
        // triggering a browser message event.
        write(': keep-alive\n\n');
      } catch {
        // We cannot confirm access during a database failure.
        closeConnection();
      } finally {
        if (!closed) {
          timer = setTimeout(
            () => void checkSession(),
            env.SSE_KEEPALIVE_INTERVAL_SECONDS * 1000,
          );
          timer.unref();
        }
      }
    }

    response.on('close', cleanup);

    unsubscribe = subscribeToDeviceChanges(() => {
      write('event: devices-changed\ndata: {}\n\n');
    });
    unsubscribeEvents = subscribeToEventChanges(() => {
      write('event: events-changed\ndata: {}\n\n');
    });

    write('event: devices-changed\ndata: {}\n\n');
    write('event: events-changed\ndata: {}\n\n');

    if (!closed) {
      timer = setTimeout(
        () => void checkSession(),
        env.SSE_KEEPALIVE_INTERVAL_SECONDS * 1000,
      );
      timer.unref();
    }
  },
);
