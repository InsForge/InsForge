import { Router, Response } from 'express';
import { AuthRequest, verifyAdmin } from '@/api/middlewares/auth.js';
import { FunctionService } from '@/services/functions/function.service.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { AppError } from '@/api/middlewares/error.js';
import logger from '@/utils/logger.js';
import { functionUploadRequestSchema, functionUpdateRequestSchema } from '@insforge/shared-schemas';
import { SocketManager } from '@/infra/socket/socket.manager.js';
import { DataUpdateResourceType, ServerEvents } from '@/types/socket.js';
import { successResponse, errorResponse } from '@/utils/response.js';

const router = Router();
const functionService = FunctionService.getInstance();
const auditService = AuditService.getInstance();

/**
 * GET /api/functions
 * List all edge functions
 */
router.get('/', verifyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const result = await functionService.listFunctions();
    successResponse(res, result);
  } catch {
    errorResponse(res, 'INTERNAL_ERROR', 'Failed to list functions', 500);
  }
});

/**
 * GET /api/functions/:slug
 * Get specific function details including code
 */
router.get('/:slug', verifyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;
    const func = await functionService.getFunction(slug);

    if (!func) {
      return errorResponse(res, 'NOT_FOUND', 'Function not found', 404);
    }

    successResponse(res, func);
  } catch {
    errorResponse(res, 'INTERNAL_ERROR', 'Failed to get function', 500);
  }
});

/**
 * POST /api/functions
 * Create a new function
 */
router.post('/', verifyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const validation = functionUploadRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return errorResponse(
        res,
        'VALIDATION_ERROR',
        JSON.stringify(validation.error.issues),
        400
      );
    }

    const created = await functionService.createFunction(validation.data);

    // Log audit event
    logger.info(`Function ${created.name} (${created.slug}) created by ${req.user?.email}`);
    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'CREATE_FUNCTION',
      module: 'FUNCTIONS',
      details: {
        functionId: created.id,
        slug: created.slug,
        name: created.name,
        status: created.status,
      },
      ip_address: req.ip,
    });

    const socket = SocketManager.getInstance();
    socket.broadcastToRoom('role:project_admin', ServerEvents.DATA_UPDATE, {
      resource: DataUpdateResourceType.FUNCTIONS,
    });

    successResponse(
      res,
      {
        success: true,
        function: created,
      },
      201
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(res, error.code, error.message, error.statusCode);
    }

    errorResponse(
      res,
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Failed to create function',
      500
    );
  }
});

/**
 * PUT /api/functions/:slug
 * Update an existing function
 */
router.put('/:slug', verifyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;
    const validation = functionUpdateRequestSchema.safeParse(req.body);

    if (!validation.success) {
      return errorResponse(
        res,
        'VALIDATION_ERROR',
        JSON.stringify(validation.error.issues),
        400
      );
    }

    const updated = await functionService.updateFunction(slug, validation.data);

    if (!updated) {
      return errorResponse(res, 'NOT_FOUND', 'Function not found', 404);
    }

    // Log audit event
    logger.info(`Function ${slug} updated by ${req.user?.email}`);
    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'UPDATE_FUNCTION',
      module: 'FUNCTIONS',
      details: {
        slug,
        changes: validation.data,
      },
      ip_address: req.ip,
    });

    const socket = SocketManager.getInstance();
    socket.broadcastToRoom('role:project_admin', ServerEvents.DATA_UPDATE, {
      resource: DataUpdateResourceType.FUNCTIONS,
      data: {
        slug,
      },
    });

    successResponse(res, {
      success: true,
      function: updated,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(res, error.code, error.message, error.statusCode);
    }

    errorResponse(
      res,
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Failed to update function',
      500
    );
  }
});

/**
 * DELETE /api/functions/:slug
 * Delete a function
 */
router.delete('/:slug', verifyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;
    const deleted = await functionService.deleteFunction(slug);

    if (!deleted) {
      return errorResponse(res, 'NOT_FOUND', 'Function not found', 404);
    }

    // Log audit event
    logger.info(`Function ${slug} deleted by ${req.user?.email}`);
    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'DELETE_FUNCTION',
      module: 'FUNCTIONS',
      details: {
        slug,
      },
      ip_address: req.ip,
    });

    const socket = SocketManager.getInstance();
    socket.broadcastToRoom('role:project_admin', ServerEvents.DATA_UPDATE, {
      resource: DataUpdateResourceType.FUNCTIONS,
    });

    successResponse(res, {
      success: true,
      message: `Function ${slug} deleted successfully`,
    });
  } catch {
    errorResponse(res, 'INTERNAL_ERROR', 'Failed to delete function', 500);
  }
});

export default router;
