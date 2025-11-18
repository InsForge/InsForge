import { Router, Response } from 'express';
import { AuthRequest, verifyAdmin } from '@/api/middleware/auth.js';
import { FunctionService } from '@/services/functions/functions.service.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { AppError } from '@/api/middleware/error.js';
import logger from '@/utils/logger.js';
import { functionUploadRequestSchema, functionUpdateRequestSchema } from '@insforge/shared-schemas';
import { SocketService } from '@/infra/socket/socket';
import { DataUpdateResourceType, ServerEvents } from '@/types/socket';

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
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Failed to list functions' });
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
      return res.status(404).json({ error: 'Function not found' });
    }

    res.json(func);
  } catch {
    res.status(500).json({ error: 'Failed to get function' });
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
      return res.status(400).json({
        error: 'Invalid request',
        details: validation.error.issues,
      });
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

    const socket = SocketService.getInstance();
    socket.broadcastToRoom('role:project_admin', ServerEvents.DATA_UPDATE, {
      resource: DataUpdateResourceType.FUNCTIONS,
    });

    res.status(201).json({
      success: true,
      function: created,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        error: error.code,
        message: error.message,
      });
    }

    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Failed to create function',
    });
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
      return res.status(400).json({
        error: 'Invalid request',
        details: validation.error.issues,
      });
    }

    const updated = await functionService.updateFunction(slug, validation.data);

    if (!updated) {
      return res.status(404).json({ error: 'Function not found' });
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

    const socket = SocketService.getInstance();
    socket.broadcastToRoom('role:project_admin', ServerEvents.DATA_UPDATE, {
      resource: DataUpdateResourceType.FUNCTIONS,
      data: {
        slug,
      },
    });

    res.json({
      success: true,
      function: updated,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        error: error.code,
        message: error.message,
      });
    }

    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Failed to update function',
    });
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
      return res.status(404).json({ error: 'Function not found' });
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

    const socket = SocketService.getInstance();
    socket.broadcastToRoom('role:project_admin', ServerEvents.DATA_UPDATE, {
      resource: DataUpdateResourceType.FUNCTIONS,
    });

    res.json({
      success: true,
      message: `Function ${slug} deleted successfully`,
    });
  } catch {
    res.status(500).json({ error: 'Failed to delete function' });
  }
});

export default router;
