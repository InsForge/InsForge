import { Router, Response, NextFunction } from 'express';
import { AuthRequest, verifyAdmin } from '@/api/middlewares/auth.js';
import { ComputeService } from '@/services/compute/compute.service.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import {
  createContainerSchema,
  updateContainerSchema,
  deployContainerSchema,
} from '@insforge/shared-schemas';
import { successResponse } from '@/utils/response.js';

export const computeRouter = Router();
const computeService = ComputeService.getInstance();

// ─── Container CRUD ────────────────────────────────────────────────────────────

/**
 * POST /api/compute/containers
 * Create a new container
 */
computeRouter.post(
  '/',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validation = createContainerSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const projectId = (req.query.project_id as string) || 'default';

      const container = await computeService.createContainer({
        ...validation.data,
        projectId,
      });

      logger.info('Container created via API', { id: container.id, actor: req.user?.email });
      successResponse(res, container, 201);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/compute/containers?project_id=<id>
 * List containers for a project
 */
computeRouter.get('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const projectId = (req.query.project_id as string) || 'default';

    const containers = await computeService.getContainers(projectId);
    successResponse(res, containers);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/compute/containers/:id
 * Get a single container
 */
computeRouter.get(
  '/:id',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const container = await computeService.getContainer(id);

      if (!container) {
        throw new AppError('Container not found', 404, ERROR_CODES.NOT_FOUND);
      }

      successResponse(res, container);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/compute/containers/:id
 * Update a container
 */
computeRouter.patch(
  '/:id',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const validation = updateContainerSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const container = await computeService.updateContainer(id, validation.data);

      if (!container) {
        throw new AppError('Container not found', 404, ERROR_CODES.NOT_FOUND);
      }

      logger.info('Container updated via API', { id, actor: req.user?.email });
      successResponse(res, container);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/compute/containers/:id
 * Delete a container
 */
computeRouter.delete(
  '/:id',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const deleted = await computeService.deleteContainer(id);

      if (!deleted) {
        throw new AppError('Container not found', 404, ERROR_CODES.NOT_FOUND);
      }

      logger.info('Container deleted via API', { id, actor: req.user?.email });
      successResponse(res, { success: true, message: `Container ${id} deleted successfully` });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Deployments ───────────────────────────────────────────────────────────────

/**
 * POST /api/compute/containers/:id/deploy
 * Trigger a deployment
 */
computeRouter.post(
  '/:id/deploy',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const validation = deployContainerSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const deployment = await computeService.deploy({
        containerId: id,
        triggeredBy: validation.data.triggeredBy,
        githubToken: req.body.github_token as string | undefined,
      });

      logger.info('Deployment triggered via API', {
        containerId: id,
        deploymentId: deployment.id,
        actor: req.user?.email,
      });
      successResponse(res, deployment, 202);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/compute/containers/:id/deployments
 * List deployments for a container
 */
computeRouter.get(
  '/:id/deployments',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const deployments = await computeService.getDeployments(id);
      successResponse(res, deployments);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/compute/containers/:id/deployments/:did
 * Get a single deployment
 */
computeRouter.get(
  '/:id/deployments/:did',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { did } = req.params;
      const deployment = await computeService.getDeployment(did);

      if (!deployment) {
        throw new AppError('Deployment not found', 404, ERROR_CODES.NOT_FOUND);
      }

      successResponse(res, deployment);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/compute/containers/:id/rollback/:did
 * Rollback to a specific deployment
 */
computeRouter.post(
  '/:id/rollback/:did',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id, did } = req.params;
      const deployment = await computeService.rollback(id, did);

      logger.info('Rollback triggered via API', {
        containerId: id,
        targetDeploymentId: did,
        newDeploymentId: deployment.id,
        actor: req.user?.email,
      });
      successResponse(res, deployment, 202);
    } catch (error) {
      next(error);
    }
  }
);

// ─── Logs ──────────────────────────────────────────────────────────────────────

/**
 * GET /api/compute/containers/:id/logs
 * Get runtime logs for a container
 * Query params: limit, start_time, next_token
 */
computeRouter.get(
  '/:id/logs',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const startTime = req.query.start_time
        ? parseInt(req.query.start_time as string, 10)
        : undefined;
      const nextToken = req.query.next_token as string | undefined;

      const logs = await computeService.getContainerLogs(id, { limit, startTime, nextToken });
      successResponse(res, logs);
    } catch (error) {
      next(error);
    }
  }
);
