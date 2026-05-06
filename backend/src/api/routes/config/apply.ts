import type { Request, Response, NextFunction } from 'express';
import { applyConfig } from '@/services/config/apply.js';
import { withConfigApplyLock } from '@/services/config/lock.js';
import { ConfigValidationError } from '@/services/config/schema.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { successResponse } from '@/utils/response.js';
import type { AuthRequest } from '@/api/middlewares/auth.js';

// The OSS backend is single-tenant — one Postgres per InsForge instance —
// so all config-apply requests serialize on the same advisory key.
// Multi-tenant cloud deployments override this via `req.projectId`.
const SINGLE_TENANT_PROJECT_KEY = 'default';

function getProjectRefFromRequest(req: AuthRequest): string {
  return req.projectId ?? SINGLE_TENANT_PROJECT_KEY;
}

export async function handleApplyConfig(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const projectRef = getProjectRefFromRequest(req as AuthRequest);
  const body = req.body as { config?: unknown; dry_run?: boolean; prune?: boolean };

  try {
    const pool = DatabaseManager.getInstance().getPool();
    const result = await withConfigApplyLock(pool, projectRef, () =>
      applyConfig({
        config: body.config,
        dry_run: body.dry_run ?? false,
        prune: body.prune ?? false,
      })
    );
    successResponse(res, result);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      res
        .status(400)
        .json({ error: 'config_validation', message: err.message, path: err.path });
      return;
    }
    next(err);
  }
}
