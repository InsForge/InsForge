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
