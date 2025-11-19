import { Router } from 'express';
import { verifyCloudBackend, verifyApiKey, verifyAdmin } from '@/api/middlewares/auth.js';
import { SocketManager } from '@/infra/socket/socket.manager.js';
import { ServerEvents } from '@/types/socket.js';
import { UsageService } from '@/services/usage/usage.service.js';
import { successResponse, errorResponse } from '@/utils/response.js';

export const usageRouter = Router();
const usageService = UsageService.getInstance();

// Create MCP tool usage record
usageRouter.post('/mcp', verifyApiKey, async (req, res, next) => {
  try {
    const { tool_name, success = true } = req.body;

    if (!tool_name) {
      return errorResponse(res, 'VALIDATION_ERROR', 'tool_name is required', 400);
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
});

// Get MCP usage records
usageRouter.get('/mcp', verifyAdmin, async (req, res, next) => {
  try {
    const { limit = '5', success = 'true' } = req.query;

    // Get MCP usage records via service
    const records = await usageService.getMcpUsage(parseInt(limit as string), success === 'true');

    successResponse(res, { records });
  } catch (error) {
    next(error);
  }
});

// Get usage statistics (called by cloud backend)
usageRouter.get('/stats', verifyCloudBackend, async (req, res, next) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return errorResponse(res, 'VALIDATION_ERROR', 'start_date and end_date are required', 400);
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
});
