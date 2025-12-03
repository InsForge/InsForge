import { Router, Response, NextFunction } from 'express';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { RealtimePermissionService } from '@/services/realtime/realtime-permission.service.js';
import { successResponse } from '@/utils/response.js';

const router = Router();
const permissionService = RealtimePermissionService.getInstance();

// Get realtime RLS permissions (subscribe on channels, publish on messages)
router.get('/', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const permissions = await permissionService.getPermissions();
    successResponse(res, permissions);
  } catch (error) {
    next(error);
  }
});

export { router as permissionsRouter };
