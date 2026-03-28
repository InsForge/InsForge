import { Router, Response, NextFunction } from 'express';
import { AuthRequest, verifyAdmin } from '@/api/middlewares/auth.js';
import { ComputeService } from '@/services/compute/compute.service.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import {
  createContainerSchema,
  updateContainerSchema,
  deployContainerSchema,
  rollbackContainerSchema,
} from '@insforge/shared-schemas';
import { SocketManager } from '@/infra/socket/socket.manager.js';
import { DataUpdateResourceType, ServerEvents } from '@/types/socket.js';
import { successResponse } from '@/utils/response.js';

const computeRouter = Router();
const computeService = ComputeService.getInstance();
const auditService = AuditService.getInstance();

function formatValidationErrors(issues: { path: (string | number)[]; message: string }[]): string {
  return issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
}

function broadcastUpdate() {
  const socket = SocketManager.getInstance();
  socket.broadcastToRoom(
    'role:project_admin',
    ServerEvents.DATA_UPDATE,
    { resource: DataUpdateResourceType.COMPUTE },
    'system'
  );
}

/**
 * GET /api/compute/containers
 */
computeRouter.get(
  '/containers',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const projectId =
        typeof req.query.project_id === 'string' && req.query.project_id
          ? req.query.project_id
          : 'default';
      const containers = await computeService.listContainers(projectId);
      successResponse(res, { containers });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/compute/containers/:id
 */
computeRouter.get(
  '/containers/:id',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const container = await computeService.getContainer(req.params.id);
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
 * POST /api/compute/containers
 */
computeRouter.post(
  '/containers',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validation = createContainerSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          formatValidationErrors(validation.error.issues),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const projectId =
        typeof req.query.project_id === 'string' && req.query.project_id
          ? req.query.project_id
          : 'default';

      const container = await computeService.createContainer({
        ...validation.data,
        projectId,
      });

      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'CREATE_CONTAINER',
        module: 'COMPUTE',
        details: {
          containerId: container.id,
          name: container.name,
          sourceType: container.sourceType,
        },
      });

      broadcastUpdate();
      successResponse(res, container, 201);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/compute/containers/:id
 */
computeRouter.patch(
  '/containers/:id',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validation = updateContainerSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          formatValidationErrors(validation.error.issues),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const container = await computeService.updateContainer(req.params.id, validation.data);

      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'UPDATE_CONTAINER',
        module: 'COMPUTE',
        details: { containerId: container.id, fields: Object.keys(validation.data) },
      });

      broadcastUpdate();
      successResponse(res, container);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/compute/containers/:id
 */
computeRouter.delete(
  '/containers/:id',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await computeService.deleteContainer(req.params.id);

      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'DELETE_CONTAINER',
        module: 'COMPUTE',
        details: { containerId: req.params.id },
      });

      broadcastUpdate();
      successResponse(res, { message: 'Container deleted' });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/compute/containers/:id/deploy
 */
computeRouter.post(
  '/containers/:id/deploy',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validation = deployContainerSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          formatValidationErrors(validation.error.issues),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const deployment = await computeService.deploy({
        containerId: req.params.id,
        triggeredBy: validation.data.triggeredBy,
        githubToken: validation.data.githubToken,
      });

      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'DEPLOY_CONTAINER',
        module: 'COMPUTE',
        details: {
          deploymentId: deployment.id,
          containerId: req.params.id,
          triggeredBy: validation.data.triggeredBy,
        },
      });

      broadcastUpdate();
      successResponse(res, deployment, 202);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/compute/containers/:id/rollback
 */
computeRouter.post(
  '/containers/:id/rollback',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validation = rollbackContainerSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          formatValidationErrors(validation.error.issues),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const deployment = await computeService.rollback({
        containerId: req.params.id,
        deploymentId: validation.data.deploymentId,
      });

      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'ROLLBACK_CONTAINER',
        module: 'COMPUTE',
        details: {
          deploymentId: deployment.id,
          containerId: req.params.id,
          rollbackTo: validation.data.deploymentId,
        },
      });

      broadcastUpdate();
      successResponse(res, deployment, 202);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/compute/containers/:id/deployments
 */
computeRouter.get(
  '/containers/:id/deployments',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const deployments = await computeService.listDeployments(req.params.id);
      successResponse(res, { deployments });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/compute/containers/:id/logs
 */
computeRouter.get(
  '/containers/:id/logs',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const limitRaw = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const limit = limitRaw !== undefined && !isNaN(limitRaw) ? limitRaw : undefined;
      const startTimeRaw = req.query.start_time
        ? parseInt(req.query.start_time as string, 10)
        : undefined;
      const startTime =
        startTimeRaw !== undefined && !isNaN(startTimeRaw) ? startTimeRaw : undefined;
      const nextToken = (req.query.next_token as string) || undefined;

      const logs = await computeService.getContainerLogs(req.params.id, {
        limit,
        startTime,
        nextToken,
      });
      successResponse(res, logs);
    } catch (error) {
      next(error);
    }
  }
);

export { computeRouter };
