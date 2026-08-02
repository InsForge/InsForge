import { Router, Response, NextFunction } from 'express';
import { AuthRequest, verifyAdmin } from '@/api/middlewares/auth.js';
import { OAuthAppsService } from '@/services/oauth-apps/oauth-apps.service.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { successResponse } from '@/utils/response.js';

const router = Router();
const oauthService = OAuthAppsService.getInstance();

/**
 * PUBLISHED APPS
 */

// GET /api/oauth-apps
router.get('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const apps = await oauthService.listOAuthApps();
    successResponse(res, apps);
  } catch (error) {
    next(error);
  }
});

// POST /api/oauth-apps
router.post('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, website, redirect_uris } = req.body;
    
    if (!name || !website || !redirect_uris || !Array.isArray(redirect_uris)) {
      throw new AppError('Invalid input payload', 400, ERROR_CODES.INVALID_INPUT);
    }

    const result = await oauthService.createOAuthApp({ name, website, redirect_uris });
    
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/oauth-apps/:id
router.delete('/:id', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const deleted = await oauthService.deleteOAuthApp(id);
    
    if (!deleted) {
      throw new AppError('App not found', 404, ERROR_CODES.NOT_FOUND);
    }
    
    successResponse(res, { success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * AUTHORIZED APPS (Project-level)
 */

// GET /api/oauth-apps/authorizations/:projectId
router.get('/authorizations/:projectId', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const authorizations = await oauthService.listAuthorizedApps(projectId);
    successResponse(res, authorizations);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/oauth-apps/authorizations/:id
router.delete('/authorizations/:id', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const revoked = await oauthService.revokeAuthorization(id);
    
    if (!revoked) {
      throw new AppError('Authorization not found', 404, ERROR_CODES.NOT_FOUND);
    }
    
    successResponse(res, { success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
