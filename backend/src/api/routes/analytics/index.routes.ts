import { Router, Response, NextFunction } from 'express';
import {
  ERROR_CODES,
  posthogTimeframeSchema,
  posthogBreakdownSchema,
  posthogMetricSchema,
} from '@insforge/shared-schemas';
import { verifyUser, verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { AppError } from '@/api/middlewares/error.js';
import { AnalyticsService } from '@/services/analytics/analytics.service.js';

export const analyticsRouter = Router();
const service = new AnalyticsService();

const MAX_LIMIT = 100;

function parseLimit(raw: unknown): number {
  const n = parseInt(String(raw ?? '10'), 10);
  if (!Number.isFinite(n) || n <= 0) {
    return 10;
  }
  return Math.min(n, MAX_LIMIT);
}

// GET /api/analytics/connection
analyticsRouter.get(
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

// GET /api/analytics/dashboards
analyticsRouter.get(
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

// GET /api/analytics/summary
analyticsRouter.get(
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

// GET /api/analytics/events
analyticsRouter.get(
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

// DELETE /api/analytics/connection
analyticsRouter.delete(
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
// authority comes from the project JWT signed by PostHogProvider.

// GET /api/analytics/web-overview?timeframe=7d
analyticsRouter.get(
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

// GET /api/analytics/web-stats?breakdown=Page&timeframe=7d
analyticsRouter.get(
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

// GET /api/analytics/trends?metric=views&timeframe=7d
analyticsRouter.get(
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

// GET /api/analytics/retention
// Decoupled from page-level timeframe per design — always Week/8.
analyticsRouter.get(
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

// GET /api/analytics/recordings?limit=10
analyticsRouter.get(
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

// POST /api/analytics/recordings/:id/share
analyticsRouter.post(
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
