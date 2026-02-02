import { Router, Response, NextFunction } from 'express';
import { DeploymentService } from '@/services/deployments/deployment.service.js';
import { VercelProvider } from '@/providers/deployments/vercel.provider.js';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import { upsertEnvVarRequestSchema } from '@insforge/shared-schemas';

const router = Router();
const deploymentService = DeploymentService.getInstance();
const vercelProvider = VercelProvider.getInstance();
const auditService = AuditService.getInstance();

/**
 * List all environment variables
 * GET /api/deployments/env-vars
 */
router.get('/', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!deploymentService.isConfigured()) {
      throw new AppError(
        'Deployment service is not configured. Please set VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID environment variables.',
        503,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    const envVars = await vercelProvider.listEnvironmentVariables();
    successResponse(res, { envVars });
  } catch (error) {
    next(error);
  }
});

/**
 * Create or update an environment variable
 * POST /api/deployments/env-vars
 */
router.post('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!deploymentService.isConfigured()) {
      throw new AppError(
        'Deployment service is not configured. Please set VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID environment variables.',
        503,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    const validationResult = upsertEnvVarRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new AppError(
        validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const { key, value } = validationResult.data;

    await vercelProvider.upsertEnvironmentVariables([{ key, value }]);

    // Log audit
    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'UPSERT_ENV_VAR',
      module: 'DEPLOYMENTS',
      details: { key },
      ip_address: req.ip,
    });

    successResponse(
      res,
      {
        success: true,
        message: `Environment variable ${key} has been saved successfully`,
      },
      201
    );
  } catch (error) {
    next(error);
  }
});

/**
 * Delete an environment variable
 * DELETE /api/deployments/env-vars/:id
 */
router.delete('/:id', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!deploymentService.isConfigured()) {
      throw new AppError(
        'Deployment service is not configured. Please set VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID environment variables.',
        503,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    const { id } = req.params;

    await vercelProvider.deleteEnvironmentVariable(id);

    // Log audit
    await auditService.log({
      actor: req.user?.email || 'api-key',
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
});

export { router as envVarsRouter };
