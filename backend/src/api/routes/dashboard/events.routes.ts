import { Router, type Request, type Response } from 'express';
import type { DashboardEvent } from '@insforge/shared-schemas';
import { verifyAdmin } from '@/api/middlewares/auth.js';
import { dashboardEventService } from '@/services/dashboard/dashboard-event.service.js';

const HEARTBEAT_INTERVAL_MS = 25_000;

export const dashboardEventsRouter = Router();

export function formatDashboardEvent(event: DashboardEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function handleDashboardEvents(_req: Request, res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(formatDashboardEvent({ type: 'ready' }));

  const unsubscribe = dashboardEventService.subscribe((event) => {
    res.write(formatDashboardEvent(event));
  });
  const heartbeat = setInterval(() => {
    res.write(': keepalive\n\n');
  }, HEARTBEAT_INTERVAL_MS);

  let closed = false;
  const cleanup = () => {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  };

  res.once('close', cleanup);
  res.once('error', cleanup);
}

dashboardEventsRouter.get('/events', verifyAdmin, handleDashboardEvents);
