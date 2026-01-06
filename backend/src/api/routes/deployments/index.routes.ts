import { Router, Response, NextFunction } from 'express';
import { DeploymentService } from '@/services/deployments/deployment.service.js';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import { startDeploymentRequestSchema } from '@insforge/shared-schemas';

const router = Router();
const deploymentService = DeploymentService.getInstance();
const auditService = AuditService.getInstance();

/**
 * Create a new deployment record with WAITING status
 * Returns presigned URL for uploading source zip file
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

    const response = await deploymentService.createDeployment();

    // Log audit
    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'CREATE_DEPLOYMENT',
      module: 'DEPLOYMENTS',
      details: { id: response.id },
      ip_address: req.ip,
    });

    successResponse(res, response, 201);
  } catch (error) {
    next(error);
  }
});

/**
 * Start a deployment - downloads zip from S3, uploads to Vercel, creates deployment
 * POST /api/deployments/:id/start
 */
router.post(
  '/:id/start',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Check if deployment service is configured
      if (!deploymentService.isConfigured()) {
        throw new AppError(
          'Deployment service is not configured. Please set VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID environment variables.',
          503,
          ERROR_CODES.INTERNAL_ERROR
        );
      }

      const { id } = req.params;

      const validation = startDeploymentRequestSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(JSON.stringify(validation.error.issues), 400, ERROR_CODES.INVALID_INPUT);
      }

      const deployment = await deploymentService.startDeployment(id, validation.data);

      // Log audit
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'START_DEPLOYMENT',
        module: 'DEPLOYMENTS',
        details: {
          id: deployment.id,
          deploymentId: deployment.deploymentId,
          provider: deployment.provider,
          status: deployment.status,
        },
        ip_address: req.ip,
      });

      successResponse(res, deployment);
    } catch (error) {
      next(error);
    }
  }
);

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
 * Get deployment by database ID
 * GET /api/deployments/:id
 */
router.get('/:id', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const deployment = await deploymentService.getDeploymentById(id);

    if (!deployment) {
      throw new AppError(`Deployment not found: ${id}`, 404, ERROR_CODES.NOT_FOUND);
    }

    successResponse(res, deployment);
  } catch (error) {
    next(error);
  }
});

/**
 * Sync deployment status from Vercel and update database
 * POST /api/deployments/:id/sync
 */
router.post(
  '/:id/sync',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const deployment = await deploymentService.syncDeploymentById(id);

      if (!deployment) {
        throw new AppError(`Deployment not found: ${id}`, 404, ERROR_CODES.NOT_FOUND);
      }

      successResponse(res, deployment);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Cancel a deployment
 * POST /api/deployments/:id/cancel
 */
router.post(
  '/:id/cancel',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      await deploymentService.cancelDeploymentById(id);

      // Log audit
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'CANCEL_DEPLOYMENT',
        module: 'DEPLOYMENTS',
        details: { id },
        ip_address: req.ip,
      });

      successResponse(res, {
        success: true,
        message: `Deployment ${id} has been cancelled`,
      });
    } catch (error) {
      next(error);
    }
  }
);

export { router as deploymentsRouter };
