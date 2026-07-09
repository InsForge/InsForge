import { Router, NextFunction, Response } from 'express';
import {
  verifyCloudBackend,
  verifyApiKey,
  verifyAdmin,
  AuthRequest,
} from '@/api/middlewares/auth.js';
import { SocketManager } from '@/infra/socket/socket.manager.js';
import { ServerEvents } from '@/types/socket.js';
import { UsageService } from '@/services/usage/usage.service.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

export const usageRouter = Router();
const usageService = UsageService.getInstance();

// Create MCP tool usage record
usageRouter.post(
  '/mcp',
  verifyApiKey,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { tool_name, success = true } = req.body;

      if (!tool_name) {
        throw new AppError('tool_name is required', 400, ERROR_CODES.INVALID_INPUT);
      }

      // Create MCP usage record via service
      const result = await usageService.recordMCPUsage(tool_name, success);

      // Auto-set MCP status to connected on tool use (if not already)
      // Skip this if the tool name is 'cli.mcp.disconnect'
      if (tool_name !== 'cli.mcp.disconnect') {
        const currentStatus = await usageService.getMCPConnectionStatus();
        if (currentStatus !== 'connected') {
          await usageService.updateMCPConnectionStatus('connected');
          SocketManager.getInstance().broadcastToRoom(
            'role:project_admin',
            ServerEvents.MCP_STATUS_CHANGED,
            { status: 'connected' },
            'system'
          );
        }
      }

      // Broadcast MCP tool usage to frontend via socket
      SocketManager.getInstance().broadcastToRoom(
        'role:project_admin',
        ServerEvents.MCP_CONNECTED,
        { tool_name, created_at: result.created_at },
        'system'
      );

      successResponse(res, { success: true });
    } catch (error) {
      next(error);
    }
  }
);

// Get MCP connection status
usageRouter.get(
  '/mcp/status',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const status = await usageService.getMCPConnectionStatus();
      successResponse(res, { status });
    } catch (error) {
      next(error);
    }
  }
);

// Update MCP connection status (called by CLI connect/disconnect)
usageRouter.post(
  '/mcp/status',
  verifyApiKey,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { status } = req.body;

      if (status !== 'connected' && status !== 'disconnected') {
        throw new AppError(
          'status must be "connected" or "disconnected"',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      await usageService.updateMCPConnectionStatus(status);

      SocketManager.getInstance().broadcastToRoom(
        'role:project_admin',
        ServerEvents.MCP_STATUS_CHANGED,
        { status },
        'system'
      );

      successResponse(res, { success: true, status });
    } catch (error) {
      next(error);
    }
  }
);

// Get MCP usage records
usageRouter.get(
  '/mcp',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { limit = '5', success = 'true' } = req.query;

      // Get MCP usage records via service
      const records = await usageService.getMCPUsage(parseInt(limit as string), success === 'true');

      successResponse(res, { records });
    } catch (error) {
      next(error);
    }
  }
);

// Get usage statistics (called by cloud backend)
usageRouter.get(
  '/stats',
  verifyCloudBackend,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { start_date, end_date } = req.query;

      if (!start_date || !end_date) {
        throw new AppError('start_date and end_date are required', 400, ERROR_CODES.INVALID_INPUT);
      }

      // Get usage statistics via service
      const stats = await usageService.getUsageStats(
        new Date(start_date as string),
        new Date(end_date as string)
      );

      successResponse(res, stats);
    } catch (error) {
      next(error);
    }
  }
);
