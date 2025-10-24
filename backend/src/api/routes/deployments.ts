import { Router, Response, NextFunction } from 'express';
import { AuthRequest, verifyAdmin } from '@/api/middleware/auth.js';
import { DeploymentService } from '@/core/deployment/deployment.js';
import { AppError } from '@/api/middleware/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import { createDeploymentRequestSchema } from '@insforge/shared-schemas';
import { logger } from '@/utils/logger.js';

const router = Router();
const deploymentService = DeploymentService.getInstance();

/**
 * POST /api/deployments
 * Create a new deployment
 */
router.post('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
      userId: req.user?.id,
    });

    const deployment = await deploymentService.createDeployment({
      projectName,
      files,
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
 * Get current deployment
 */
router.get('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const deployment = await deploymentService.getDeployment();

    successResponse(res, deployment);
  } catch (error) {
    if (error instanceof Error && error.message === 'No deployment found') {
      next(new AppError('No deployment found', 404, ERROR_CODES.NOT_FOUND));
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
 * DELETE /api/deployments
 * Delete current deployment
 */
router.delete('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await deploymentService.deleteDeployment();

    successResponse(res, {
      message: 'Deployment deleted successfully',
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'No deployment found') {
      next(new AppError('No deployment found', 404, ERROR_CODES.NOT_FOUND));
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
