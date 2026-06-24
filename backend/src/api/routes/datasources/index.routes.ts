import { Router, Response, NextFunction } from 'express';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { DatasourceService } from '@/services/datasource/datasource.service.js';

export const datasourcesRouter = Router();
const service = DatasourceService.getInstance();

// GET /api/datasources/apify/connection
datasourcesRouter.get(
  '/apify/connection',
  verifyAdmin,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const conn = await service.getApifyConnection();
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

// DELETE /api/datasources/apify/connection
datasourcesRouter.delete(
  '/apify/connection',
  verifyAdmin,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await service.disconnectApify();
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

function parseLimit(raw: unknown, fallback: number, max: number): number {
  const n = parseInt(String(raw ?? fallback), 10);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.min(n, max);
}

// GET /api/datasources/apify/token — runtime token accessor. Admin-gated: it
// returns the user's live Apify OAuth token, so it must NOT be reachable with an
// anon key. verifyAdmin accepts the project `ik_` admin key that edge functions
// get injected, plus project_admin JWTs.
datasourcesRouter.get(
  '/apify/token',
  verifyAdmin,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const tok = await service.getApifyToken();
      if (!tok) {
        res.status(404).json({ error: 'not_connected' });
        return;
      }
      res.json(tok);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/datasources/apify/runs?limit=
datasourcesRouter.get(
  '/apify/runs',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const data = await service.getApifyRuns(parseLimit(req.query.limit, 10, 50));
      if (!data) {
        res.status(404).json({ error: 'not_connected' });
        return;
      }
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/datasources/apify/data?limit= — latest run's dataset preview
datasourcesRouter.get(
  '/apify/data',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const data = await service.getApifyLatestData(parseLimit(req.query.limit, 5, 20));
      if (!data) {
        res.status(404).json({ error: 'not_connected' });
        return;
      }
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);
