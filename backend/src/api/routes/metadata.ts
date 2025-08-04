import { Router, Response, NextFunction } from 'express';
import { MetadataService } from '@/core/metadata/metadata.js';
import { AuthService } from '@/core/auth/auth.js';
import { WebSocketService } from '@/core/websocket/websocket.js';
import { verifyUserOrApiKey, verifyUserOrAdmin, AuthRequest } from '@/api/middleware/auth.js';
import { successResponse } from '@/utils/response.js';

const router = Router();

// Get full metadata (default endpoint)
router.get('/', verifyUserOrApiKey, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const metadataService = MetadataService.getInstance();
    const metadata = await metadataService.getFullMetadata();

    // Trigger WebSocket event to notify frontend that MCP is connected
    const wsService = WebSocketService.getInstance();
    wsService.broadcastMCPConnectionSuccess();

    successResponse(res, metadata);
  } catch (error) {
    next(error);
  }
});

// Get database metadata for frontend dashboard
router.get(
  '/database',
  verifyUserOrApiKey,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const metadataService = MetadataService.getInstance();
      await metadataService.updateDatabaseMetadata();
      const databaseMetadata = await metadataService.getDatabaseMetadata();

      successResponse(res, databaseMetadata);
    } catch (error) {
      next(error);
    }
  }
);

// Get API key (admin only)
router.get(
  '/api-key',
  verifyUserOrAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const authService = AuthService.getInstance();
      const apiKey = await authService.initializeApiKey();

      successResponse(res, { api_key: apiKey });
    } catch (error) {
      next(error);
    }
  }
);

export { router as metadataRouter };
