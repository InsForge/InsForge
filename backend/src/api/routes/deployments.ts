import { Router, Response, NextFunction } from 'express';
import { AuthRequest, verifyAdmin, verifyUser } from '@/api/middleware/auth.js';
import { DeploymentService } from '@/core/deployment/deployment.js';
import { AppError } from '@/api/middleware/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import { createDeploymentRequestSchema } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';

const router = Router();
const deploymentService = DeploymentService.getInstance();

/** 
 * POST /api/deployments
 * Create a new deployment
 */
router.post('/', verifyUser, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = createDeploymentRequestSchema.safeParse(req.body);

    if (!validation.success) {
      throw new AppError(
        `Validation error: ${validation.error.errors.map((e) => e.message).join(', ')}`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const { projectName, files } = validation.data;

    logger.info('Creating deployment', {
      projectName,
      fileCount: files.length,
      user: req.user?.email,
    });

    const deployment = await deploymentService.createDeployment({
      projectName,
      files,
      userId: req.user?.id,
    });

    successResponse(
      res,
      {
        ...deployment,
        message: 'Deployment created successfully',
      },
      201
    );
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(
        new AppError(
          error instanceof Error ? error.message : 'Failed to create deployment',
          500,
          ERROR_CODES.INTERNAL_ERROR
        )
      );
    }
  }
});

/**
 * GET /api/deployments
 * List all deployments
 */
router.get('/', verifyUser, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Admin can see all deployments, users see only their own
    const userId = req.user?.role === 'project_admin' ? undefined : req.user?.id;

    const deployments = await deploymentService.listDeployments(userId);

    successResponse(res, deployments);
  } catch (error) {
    next(
      new AppError(
        error instanceof Error ? error.message : 'Failed to list deployments',
        500,
        ERROR_CODES.INTERNAL_ERROR
      )
    );
  }
});

/**
 * GET /api/deployments/:id
 * Get deployment by ID
 */
router.get('/:id', verifyUser, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const deployment = await deploymentService.getDeployment(id);

    successResponse(res, deployment);
  } catch (error) {
    if (error instanceof Error && error.message === 'Deployment not found') {
      next(new AppError('Deployment not found', 404, ERROR_CODES.NOT_FOUND));
    } else {
      next(
        new AppError(
          error instanceof Error ? error.message : 'Failed to get deployment',
          500,
          ERROR_CODES.INTERNAL_ERROR
        )
      );
    }
  }
});

/**
 * DELETE /api/deployments/:id
 * Delete deployment
 */
router.delete('/:id', verifyUser, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const isAdmin = req.user?.role === 'project_admin';

    await deploymentService.deleteDeployment(id, req.user?.id, isAdmin);

    successResponse(res, {
      message: 'Deployment deleted successfully',
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Deployment not found') {
      next(new AppError('Deployment not found', 404, ERROR_CODES.NOT_FOUND));
    } else if (error instanceof Error && error.message.includes('Permission denied')) {
      next(new AppError(error.message, 403, ERROR_CODES.FORBIDDEN));
    } else {
      next(
        new AppError(
          error instanceof Error ? error.message : 'Failed to delete deployment',
          500,
          ERROR_CODES.INTERNAL_ERROR
        )
      );
    }
  }
});

export { router as deploymentsRouter };
