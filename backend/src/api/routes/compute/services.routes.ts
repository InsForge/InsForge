import { Router, Response, NextFunction } from 'express';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { ComputeServicesService } from '@/services/compute/services.service.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { createServiceSchema, updateServiceSchema } from '@insforge/shared-schemas';
import { AuditService } from '@/services/logs/audit.service.js';
import { SocketManager } from '@/infra/socket/socket.manager.js';
import { DataUpdateResourceType, ServerEvents } from '@/types/socket.js';
import logger from '@/utils/logger.js';

const router = Router();
const auditService = AuditService.getInstance();

function getProjectId(req: AuthRequest): string {
  return (req.query.project_id as string) || 'default';
}

function bestEffortAudit(params: Parameters<typeof auditService.log>[0]) {
  auditService.log(params).catch((err) => {
    logger.error('Audit log failed (best-effort)', { error: err });
  });
}

function bestEffortBroadcast() {
  try {
    const socket = SocketManager.getInstance();
    socket.broadcastToRoom(
      'role:project_admin',
      ServerEvents.DATA_UPDATE,
      { resource: DataUpdateResourceType.COMPUTE_SERVICES },
      'system'
    );
  } catch (err) {
    logger.error('Socket broadcast failed (best-effort)', { error: err });
  }
}

// List services
router.get('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const svc = ComputeServicesService.getInstance();
    const services = await svc.listServices(getProjectId(req));
    successResponse(res, services);
  } catch (error) {
    next(error);
  }
});

// Get service
router.get('/:id', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const svc = ComputeServicesService.getInstance();
    const service = await svc.getService(req.params.id);

    if (service.projectId !== getProjectId(req)) {
      throw new AppError('Service not found', 404, ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND);
    }

    successResponse(res, service);
  } catch (error) {
    next(error);
  }
});

// Create service
router.post('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = createServiceSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT,
        'Please check the request body, it must conform with the CreateServiceRequest schema.'
      );
    }

    const svc = ComputeServicesService.getInstance();
    const projectId = getProjectId(req);
    const service = await svc.createService({ ...validation.data, projectId });

    successResponse(res, service, 201);

    bestEffortAudit({
      actor: req.user?.email || 'api-key',
      action: 'CREATE_COMPUTE_SERVICE',
      module: 'COMPUTE',
      details: { serviceName: validation.data.name, projectId },
      ip_address: req.ip,
    });
    bestEffortBroadcast();
  } catch (error) {
    next(error);
  }
});

// Update service
router.patch('/:id', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = updateServiceSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT,
        'Please check the request body, it must conform with the UpdateServiceRequest schema.'
      );
    }

    const svc = ComputeServicesService.getInstance();
    const existing = await svc.getService(req.params.id);

    if (existing.projectId !== getProjectId(req)) {
      throw new AppError('Service not found', 404, ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND);
    }

    const service = await svc.updateService(req.params.id, validation.data);

    successResponse(res, service);

    bestEffortAudit({
      actor: req.user?.email || 'api-key',
      action: 'UPDATE_COMPUTE_SERVICE',
      module: 'COMPUTE',
      details: { serviceId: req.params.id, changes: validation.data },
      ip_address: req.ip,
    });
    bestEffortBroadcast();
  } catch (error) {
    next(error);
  }
});

// Delete service
router.delete('/:id', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const svc = ComputeServicesService.getInstance();
    const existing = await svc.getService(req.params.id);

    if (existing.projectId !== getProjectId(req)) {
      throw new AppError('Service not found', 404, ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND);
    }

    await svc.deleteService(req.params.id);

    successResponse(res, { message: 'Service deleted' });

    bestEffortAudit({
      actor: req.user?.email || 'api-key',
      action: 'DELETE_COMPUTE_SERVICE',
      module: 'COMPUTE',
      details: { serviceId: req.params.id, serviceName: existing.name },
      ip_address: req.ip,
    });
    bestEffortBroadcast();
  } catch (error) {
    next(error);
  }
});

// Stop service
router.post(
  '/:id/stop',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const svc = ComputeServicesService.getInstance();
      const existing = await svc.getService(req.params.id);

      if (existing.projectId !== getProjectId(req)) {
        throw new AppError('Service not found', 404, ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND);
      }

      const service = await svc.stopService(req.params.id);

      successResponse(res, service);

      bestEffortAudit({
        actor: req.user?.email || 'api-key',
        action: 'STOP_COMPUTE_SERVICE',
        module: 'COMPUTE',
        details: { serviceId: req.params.id, serviceName: existing.name },
        ip_address: req.ip,
      });
      bestEffortBroadcast();
    } catch (error) {
      next(error);
    }
  }
);

// Start service
router.post(
  '/:id/start',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const svc = ComputeServicesService.getInstance();
      const existing = await svc.getService(req.params.id);

      if (existing.projectId !== getProjectId(req)) {
        throw new AppError('Service not found', 404, ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND);
      }

      const service = await svc.startService(req.params.id);

      successResponse(res, service);

      bestEffortAudit({
        actor: req.user?.email || 'api-key',
        action: 'START_COMPUTE_SERVICE',
        module: 'COMPUTE',
        details: { serviceId: req.params.id, serviceName: existing.name },
        ip_address: req.ip,
      });
      bestEffortBroadcast();
    } catch (error) {
      next(error);
    }
  }
);

// Get service logs
router.get(
  '/:id/logs',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const svc = ComputeServicesService.getInstance();
      const existing = await svc.getService(req.params.id);

      if (existing.projectId !== getProjectId(req)) {
        throw new AppError('Service not found', 404, ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND);
      }

      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
      const logs = await svc.getServiceLogs(req.params.id, { limit });

      successResponse(res, logs);
    } catch (error) {
      next(error);
    }
  }
);

export { router as servicesRouter };
