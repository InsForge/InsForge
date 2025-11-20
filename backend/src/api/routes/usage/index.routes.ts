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
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';

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
      const result = await usageService.createMcpUsage(tool_name, success);

      // Broadcast MCP tool usage to frontend via socket
      const socketService = SocketManager.getInstance();

      socketService.broadcastToRoom('role:project_admin', ServerEvents.MCP_CONNECTED, {
        tool_name,
        created_at: result.created_at,
      });

      successResponse(res, { success: true });
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
      const records = await usageService.getMcpUsage(parseInt(limit as string), success === 'true');

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
