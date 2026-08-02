import { Router, Response, NextFunction } from 'express';
import {
  ERROR_CODES,
  posthogTimeframeSchema,
  posthogBreakdownSchema,
  posthogMetricSchema,
  posthogRegionSchema,
  recordAgentToolCallSchema,
  updatePosthogConfigSchema,
} from '@insforge/shared-schemas';
import { verifyUser, verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { AppError } from '@/utils/errors.js';
import { AnalyticsService } from '@/services/analytics/analytics.service.js';
import { AgentTelemetryService } from '@/services/telemetry/agent-telemetry.service.js';
import { successResponse } from '@/utils/response.js';

export const analyticsRouter = Router();
const service = AnalyticsService.getInstance();

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

// Cloud projects get their PostHog connection through OAuth on cloud-backend,
// so the local credential store is not theirs to write. Mirrors
// assertSelfHostedWebscraperConfig().
function assertSelfHostedAnalyticsConfig(): void {
  if (!AnalyticsService.isSelfHosted()) {
    throw new AppError(
      'The PostHog connection is managed by InsForge Cloud.',
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }
}

// GET /api/analytics/config — connection status for the settings UI. Returns the
// personal API key masked; the raw key never leaves the backend.
analyticsRouter.get(
  '/config',
  verifyAdmin,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Guarded like the two writes below. Unguarded on Cloud it reads a store
      // Cloud never writes and answers `configured: false`, which invites the
      // settings UI to render a connect form whose PUT then 400s.
      assertSelfHostedAnalyticsConfig();
      res.json(await service.getConfig());
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/analytics/config/projects — list the PostHog projects a candidate key
// can see, so the connect dialog can offer a picker instead of asking for a
// numeric project id. Nothing is stored; this doubles as "test connection".
analyticsRouter.post(
  '/config/projects',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      assertSelfHostedAnalyticsConfig();
      const validation = updatePosthogConfigSchema
        .pick({ personalApiKey: true, region: true })
        .safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          `Validation error: ${validation.error.errors.map((e) => e.message).join(', ')}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }
      const projects = await service.listAvailableProjects({
        personalApiKey: validation.data.personalApiKey,
        region: posthogRegionSchema.parse(validation.data.region),
      });
      res.json({ projects });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/analytics/config — store the developer's PostHog personal API key.
// The key is exercised against PostHog before it is written, so an invalid paste
// fails loudly instead of producing a connection that 401s on every panel.
analyticsRouter.put(
  '/config',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      assertSelfHostedAnalyticsConfig();
      const validation = updatePosthogConfigSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          `Validation error: ${validation.error.errors.map((e) => e.message).join(', ')}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }
      res.json(await service.connect(validation.data));
    } catch (err) {
      next(err);
    }
  }
);

// v2.5 analytics dashboard endpoints. On Cloud these proxy to cloud-backend,
// which holds the OAuth connection; self-hosted deployments talk to PostHog
// directly with the locally stored personal API key. AnalyticsService picks the
// provider. Auth checks remain on this side via verifyUser.

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

analyticsRouter.post(
  '/agent-telemetry/events',
  verifyUser,
  (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validation = recordAgentToolCallSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError('Invalid agent telemetry event payload', 400, ERROR_CODES.INVALID_INPUT);
      }
      const projectId = req.user?.id || 'default';
      const telemetryService = AgentTelemetryService.getInstance();
      const record = telemetryService.recordToolCall(validation.data, projectId);
      successResponse(res, record, 201);
    } catch (err) {
      next(err);
    }
  }
);

analyticsRouter.get(
  '/agent-telemetry/stats',
  verifyUser,
  (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = req.user?.id || 'default';
      const telemetryService = AgentTelemetryService.getInstance();
      const stats = telemetryService.getSystemAgentStats(projectId);
      successResponse(res, stats);
    } catch (err) {
      next(err);
    }
  }
);

analyticsRouter.get(
  '/agent-telemetry/session/:id',
  verifyUser,
  (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sessionId = String(req.params.id || '');
      const projectId = req.user?.id || 'default';
      const telemetryService = AgentTelemetryService.getInstance();
      const metrics = telemetryService.getSessionMetrics(sessionId, projectId);
      if (!metrics) {
        throw new AppError('Agent session not found', 404, ERROR_CODES.NOT_FOUND);
      }
      successResponse(res, metrics);
    } catch (err) {
      next(err);
    }
  }
);
