import { Router, Response, NextFunction } from 'express';
import { requireEnvVarStore } from '@/services/deployments/sites-registry.js';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { deploymentsWriteLimiter } from '@/api/middlewares/rate-limiters.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { AppError } from '@/utils/errors.js';
import { successResponse } from '@/utils/response.js';
import { ERROR_CODES, upsertEnvVarsRequestSchema } from '@insforge/shared-schemas';

const router = Router();
const auditService = AuditService.getInstance();

/**
 * List all environment variables
 * GET /api/deployments/env-vars
 */
router.get('/', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const envVars = await requireEnvVarStore().list();
    successResponse(res, { envVars });
  } catch (error) {
    next(error);
  }
});

/**
 * Create or update environment variables
 * POST /api/deployments/env-vars
 */
router.post(
  '/',
  verifyAdmin,
  deploymentsWriteLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validationResult = upsertEnvVarsRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const { envVars } = validationResult.data;

      await requireEnvVarStore().upsert(envVars);

      await auditService.log({
        actor: req.hasApiKey ? 'api-key' : req.user?.id,
        action: 'UPSERT_ENV_VARS',
        module: 'DEPLOYMENTS',
        details: { count: envVars.length, keys: envVars.map((envVar) => envVar.key) },
        ip_address: req.ip,
      });

      successResponse(
        res,
        {
          success: true,
          message: `${envVars.length} environment variables have been saved successfully`,
          count: envVars.length,
        },
        201
      );
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Get a single environment variable with decrypted value
 * GET /api/deployments/env-vars/:id
 */
router.get('/:id', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const envVar = await requireEnvVarStore().get(id);

    successResponse(res, { envVar });
  } catch (error) {
    next(error);
  }
});

/**
 * Delete an environment variable
 * DELETE /api/deployments/env-vars/:id
 */
router.delete(
  '/:id',
  verifyAdmin,
  deploymentsWriteLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      await requireEnvVarStore().remove(id);

      // Log audit
      await auditService.log({
        actor: req.hasApiKey ? 'api-key' : req.user?.id,
        action: 'DELETE_ENV_VAR',
        module: 'DEPLOYMENTS',
        details: { envId: id },
        ip_address: req.ip,
      });

      successResponse(res, {
        success: true,
        message: 'Environment variable has been deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export { router as envVarsRouter };
