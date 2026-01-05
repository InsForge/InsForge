import { Router, Response, NextFunction } from 'express';
import { DeploymentService } from '@/services/deployments/deployment.service.js';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';

const router = Router();
const deploymentService = DeploymentService.getInstance();
const auditService = AuditService.getInstance();

/**
 * Create a new deployment
 * POST /api/deployments
 */
router.post('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Check if deployment service is configured
    if (!deploymentService.isConfigured()) {
      throw new AppError(
        'Deployment service is not configured. Please set VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID environment variables.',
        503,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    const { name, files, target, projectSettings, meta } = req.body;

    const deployment = await deploymentService.createDeployment({
      name,
      files,
      target,
      projectSettings,
      meta,
    });

    // Log audit
    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'CREATE_DEPLOYMENT',
      module: 'DEPLOYMENTS',
      details: {
        id: deployment.id,
        deploymentId: deployment.deploymentId,
        provider: deployment.provider,
        target,
      },
      ip_address: req.ip,
    });

    successResponse(res, deployment, 201);
  } catch (error) {
    next(error);
  }
});

/**
 * List all deployments
 * GET /api/deployments
 */
router.get('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const deployments = await deploymentService.listDeployments(limit, offset);

    successResponse(res, { deployments });
  } catch (error) {
    next(error);
  }
});

/**
 * Get deployment from database by deployment ID
 * GET /api/deployments/:deploymentId
 */
router.get(
  '/:deploymentId',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { deploymentId } = req.params;

      const deployment = await deploymentService.getDeployment(deploymentId);

      if (!deployment) {
        throw new AppError(`Deployment not found: ${deploymentId}`, 404, ERROR_CODES.NOT_FOUND);
      }

      successResponse(res, deployment);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Sync deployment status from Vercel and update database
 * POST /api/deployments/:deploymentId/sync
 */
router.post(
  '/:deploymentId/sync',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { deploymentId } = req.params;

      const deployment = await deploymentService.syncDeployment(deploymentId);

      if (!deployment) {
        throw new AppError(`Deployment not found: ${deploymentId}`, 404, ERROR_CODES.NOT_FOUND);
      }

      successResponse(res, deployment);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Cancel a deployment
 * POST /api/deployments/:deploymentId/cancel
 */
router.post(
  '/:deploymentId/cancel',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { deploymentId } = req.params;

      // Check if deployment exists
      const deployment = await deploymentService.getDeployment(deploymentId);
      if (!deployment) {
        throw new AppError(`Deployment not found: ${deploymentId}`, 404, ERROR_CODES.NOT_FOUND);
      }

      await deploymentService.cancelDeployment(deploymentId);

      // Log audit
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'CANCEL_DEPLOYMENT',
        module: 'DEPLOYMENTS',
        details: { deploymentId },
        ip_address: req.ip,
      });

      successResponse(res, {
        success: true,
        message: `Deployment ${deploymentId} has been cancelled`,
      });
    } catch (error) {
      next(error);
    }
  }
);

export { router as deploymentsRouter };
