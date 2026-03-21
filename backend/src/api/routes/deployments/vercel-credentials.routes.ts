import { Router, Response, NextFunction } from 'express';
import { SecretService } from '@/services/secrets/secret.service.js';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { AppError } from '@/api/middlewares/error.js';
import { successResponse } from '@/utils/response.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { z } from 'zod';

const router = Router();
const secretService = SecretService.getInstance();
const auditService = AuditService.getInstance();

const credentialsSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  teamId: z.string().optional(),
  projectId: z.string().optional(),
});

/**
 * Get current credentials source and masked details
 * GET /api/deployments/vercel/credentials
 */
router.get('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const customToken = await secretService.getSecretByKey('VERCEL_CUSTOM_TOKEN');
    const customTeamId = await secretService.getSecretByKey('VERCEL_CUSTOM_TEAM_ID');
    const customProjectId = await secretService.getSecretByKey('VERCEL_CUSTOM_PROJECT_ID');

    const hasCustom = !!(customToken && customTeamId && customProjectId);

    const token = customToken || process.env.VERCEL_TOKEN;
    const teamId = customTeamId || process.env.VERCEL_TEAM_ID;
    const projectId = customProjectId || process.env.VERCEL_PROJECT_ID;

    const mask = (str: string | undefined) =>
      str ? `${str.substring(0, 4)}...${str.substring(str.length - 4)}` : null;

    successResponse(res, {
      configured: !!(token && teamId && projectId),
      source: hasCustom ? 'custom' : process.env.VERCEL_TOKEN ? 'env' : 'none',
      details: {
        token: mask(token),
        teamId: mask(teamId),
        projectId: mask(projectId),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Set custom credentials
 * PUT /api/deployments/vercel/credentials
 */
router.put('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = credentialsSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const { token, teamId, projectId } = validation.data;

    const upsert = async (key: string, value: string) => {
      const updated = await secretService.updateSecretByKey(key, { value });
      if (!updated) {
        await secretService.createSecret({ key, value, isReserved: false });
      }
    };

    await upsert('VERCEL_CUSTOM_TOKEN', token);
    await upsert('VERCEL_CUSTOM_TEAM_ID', teamId || '');
    await upsert('VERCEL_CUSTOM_PROJECT_ID', projectId || '');

    // Log audit
    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'SET_VERCEL_CREDENTIALS',
      module: 'DEPLOYMENTS',
      details: { message: 'Custom Vercel credentials updated' },
      ip_address: req.ip,
    });

    successResponse(res, { success: true, message: 'Vercel credentials saved successfully' });
  } catch (error) {
    next(error);
  }
});

/**
 * Clear custom credentials
 * DELETE /api/deployments/vercel/credentials
 */
router.delete('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await secretService.deleteSecretByKey('VERCEL_CUSTOM_TOKEN');
    await secretService.deleteSecretByKey('VERCEL_CUSTOM_TEAM_ID');
    await secretService.deleteSecretByKey('VERCEL_CUSTOM_PROJECT_ID');

    // Log audit
    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'CLEAR_VERCEL_CREDENTIALS',
      module: 'DEPLOYMENTS',
      details: { message: 'Custom Vercel credentials cleared' },
      ip_address: req.ip,
    });

    successResponse(res, { success: true, message: 'Custom credentials cleared' });
  } catch (error) {
    next(error);
  }
});

export { router as vercelCredentialsRouter };
