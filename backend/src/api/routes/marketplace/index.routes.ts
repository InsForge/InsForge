import { Router, Response, NextFunction } from 'express';
import {
  ERROR_CODES,
  installMarketplacePluginRequestSchema,
  type InstallMarketplacePluginResponse,
  type UninstallMarketplacePluginResponse,
} from '@insforge/shared-schemas';
import { MarketplaceService } from '@/services/marketplace/marketplace.service.js';
import { FunctionService } from '@/services/functions/function.service.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { marketplaceInstallRateLimiter } from '@/api/middlewares/rate-limiters.js';
import { AppError } from '@/utils/errors.js';
import { successResponse } from '@/utils/response.js';

const router = Router();
const marketplaceService = MarketplaceService.getInstance();
const auditService = AuditService.getInstance();
const functionService = FunctionService.getInstance();

// Installs create/remove secrets, which are injected into edge-function
// environments — redeploy so functions see the change (non-blocking, debounced)
const triggerSecretsRedeployment = () => {
  if (functionService.isSubhostingConfigured()) {
    functionService.redeploy();
  }
};

/**
 * List marketplace plugins with installed status
 * GET /api/marketplace/plugins
 */
router.get(
  '/plugins',
  verifyAdmin,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const plugins = await marketplaceService.listPlugins();
      successResponse(res, { plugins });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Install a plugin (validate the provider API key, store it as a secret)
 * POST /api/marketplace/plugins/:slug/install
 */
router.post(
  '/plugins/:slug/install',
  verifyAdmin,
  marketplaceInstallRateLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { slug } = req.params;
      const parseResult = installMarketplacePluginRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new AppError(
          `Invalid request: ${parseResult.error.errors.map((e) => e.message).join(', ')}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const plugin = await marketplaceService.installPlugin(slug, parseResult.data.apiKey);

      await auditService.log({
        actor: req.hasApiKey ? 'api-key' : req.user?.id,
        action: 'INSTALL_PLUGIN',
        module: 'MARKETPLACE',
        details: { slug, secretName: plugin.install.secretName },
        ip_address: req.ip,
      });

      triggerSecretsRedeployment();

      const response: InstallMarketplacePluginResponse = {
        success: true,
        message: `${plugin.name} has been installed successfully`,
      };
      successResponse(res, response, 201);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Uninstall a plugin (deactivate its secret)
 * DELETE /api/marketplace/plugins/:slug
 */
router.delete(
  '/plugins/:slug',
  verifyAdmin,
  marketplaceInstallRateLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { slug } = req.params;
      const plugin = await marketplaceService.uninstallPlugin(slug);

      await auditService.log({
        actor: req.hasApiKey ? 'api-key' : req.user?.id,
        action: 'UNINSTALL_PLUGIN',
        module: 'MARKETPLACE',
        details: { slug, secretName: plugin.install.secretName },
        ip_address: req.ip,
      });

      triggerSecretsRedeployment();

      const response: UninstallMarketplacePluginResponse = {
        success: true,
        message: `${plugin.name} has been uninstalled successfully`,
      };
      successResponse(res, response);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
