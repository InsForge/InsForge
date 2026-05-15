import { Router, Response, NextFunction } from 'express';
import {
  posthogTimeframeSchema,
  posthogBreakdownSchema,
  posthogMetricSchema,
} from '@insforge/shared-schemas';
import { verifyUser, verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { PosthogService } from '@/services/posthog/posthog.service.js';

export const posthogRouter = Router();
const service = new PosthogService();

const MAX_LIMIT = 100;

function parseLimit(raw: unknown): number {
  const n = parseInt(String(raw ?? '10'), 10);
  if (!Number.isFinite(n) || n <= 0) {
    return 10;
  }
  return Math.min(n, MAX_LIMIT);
}

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
      const data = await service.getRecentEvents(parseLimit(req.query.limit));
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/integrations/posthog/connection
posthogRouter.delete(
  '/connection',
  verifyAdmin,
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
      const timeframe = posthogTimeframeSchema.safeParse(req.query.timeframe ?? '7d');
      if (!timeframe.success) {
        throw new AppError('Invalid timeframe', 400, ERROR_CODES.INVALID_INPUT);
      }
      const data = await service.getWebOverview(timeframe.data);
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
      const breakdown = posthogBreakdownSchema.safeParse(req.query.breakdown);
      if (!breakdown.success) {
        throw new AppError('Invalid breakdown', 400, ERROR_CODES.INVALID_INPUT);
      }
      const timeframe = posthogTimeframeSchema.safeParse(req.query.timeframe ?? '7d');
      if (!timeframe.success) {
        throw new AppError('Invalid timeframe', 400, ERROR_CODES.INVALID_INPUT);
      }
      const data = await service.getWebStats(breakdown.data, timeframe.data);
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
      const metric = posthogMetricSchema.safeParse(req.query.metric);
      if (!metric.success) {
        throw new AppError('Invalid metric', 400, ERROR_CODES.INVALID_INPUT);
      }
      const timeframe = posthogTimeframeSchema.safeParse(req.query.timeframe ?? '7d');
      if (!timeframe.success) {
        throw new AppError('Invalid timeframe', 400, ERROR_CODES.INVALID_INPUT);
      }
      const data = await service.getTrends(metric.data, timeframe.data);
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
      const data = await service.getRecordings(parseLimit(req.query.limit));
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
