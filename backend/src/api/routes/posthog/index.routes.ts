import { Router, Response, NextFunction } from 'express';
import { verifyUser, AuthRequest } from '@/api/middlewares/auth.js';
import { PosthogService } from '@/services/posthog/posthog.service.js';

export const posthogRouter = Router();
const service = new PosthogService();

// GET /api/integrations/posthog/connection
posthogRouter.get(
  '/connection',
  verifyUser,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const conn = await service.getConnection();
      if (!conn) {
        res.status(404).json({ error: 'not_connected' });
        return;
      }
      res.json({ connected: true, connection: conn });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/integrations/posthog/dashboards
posthogRouter.get(
  '/dashboards',
  verifyUser,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const data = await service.getDashboards();
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/integrations/posthog/summary
posthogRouter.get(
  '/summary',
  verifyUser,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const data = await service.getSummary();
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/integrations/posthog/events
posthogRouter.get(
  '/events',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const limit = parseInt(String(req.query.limit ?? '10'), 10) || 10;
      const data = await service.getRecentEvents(limit);
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/integrations/posthog/connection
posthogRouter.delete(
  '/connection',
  verifyUser,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await service.disconnect();
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

// v2.5 analytics dashboard endpoints — proxy to cloud-backend, which talks to
// PostHog. Auth/auth checks remain on this side via verifyUser; project
// authority comes from the project JWT signed by CloudPosthogProvider.

// GET /api/integrations/posthog/web-overview?timeframe=7d
posthogRouter.get(
  '/web-overview',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const timeframe = String(req.query.timeframe || '7d');
      const data = await service.getWebOverview(timeframe);
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/integrations/posthog/web-stats?breakdown=Page&timeframe=7d
posthogRouter.get(
  '/web-stats',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const breakdown = String(req.query.breakdown || '');
      const timeframe = String(req.query.timeframe || '7d');
      const data = await service.getWebStats(breakdown, timeframe);
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/integrations/posthog/trends?metric=views&timeframe=7d
posthogRouter.get(
  '/trends',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const metric = String(req.query.metric || '');
      const timeframe = String(req.query.timeframe || '7d');
      const data = await service.getTrends(metric, timeframe);
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/integrations/posthog/retention
// Decoupled from page-level timeframe per design — always Week/8.
posthogRouter.get(
  '/retention',
  verifyUser,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const data = await service.getRetention();
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/integrations/posthog/recordings?limit=10
posthogRouter.get(
  '/recordings',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const limit = parseInt(String(req.query.limit ?? '10'), 10) || 10;
      const data = await service.getRecordings(limit);
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/integrations/posthog/recordings/:id/share
posthogRouter.post(
  '/recordings/:id/share',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const recordingId = String(req.params.id || '');
      const data = await service.createRecordingShare(recordingId);
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);
