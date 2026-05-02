import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { DeploymentService } from '@/services/deployments/deployment.service.js';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse, paginatedResponse } from '@/utils/response.js';
import {
  createDirectDeploymentRequestSchema,
  startDeploymentRequestSchema,
  updateSlugRequestSchema,
  addCustomDomainRequestSchema,
} from '@insforge/shared-schemas';
import { envVarsRouter } from './env-vars.routes.js';

const router = Router();
const deploymentService = DeploymentService.getInstance();
const auditService = AuditService.getInstance();
const domainParamSchema = addCustomDomainRequestSchema.shape.domain;
const uuidParamSchema = z.string().uuid();

// Mount sub-routers first to avoid conflicts with parameterized routes
router.use('/env-vars', envVarsRouter);

/**
 * Create a new deployment record with WAITING status
 * Returns presigned upload info for the legacy source zip flow
 * POST /api/deployments
 */
router.post('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const response = await deploymentService.createDeployment();

    // Log audit
    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'CREATE_DEPLOYMENT',
      module: 'DEPLOYMENTS',
      details: { id: response.id },
      ip_address: req.ip,
    });

    successResponse(res, response, 201);
  } catch (error) {
    next(error);
  }
});

/**
 * Create a new direct-upload deployment record with WAITING status
 * POST /api/deployments/direct
 */
router.post('/direct', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validationResult = createDirectDeploymentRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new AppError(
        validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const response = await deploymentService.createDirectDeployment(validationResult.data);

    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'CREATE_DIRECT_DEPLOYMENT',
      module: 'DEPLOYMENTS',
      details: { id: response.id, fileCount: response.files.length },
      ip_address: req.ip,
    });

    successResponse(res, response, 201);
  } catch (error) {
    next(error);
  }
});

/**
 * Stream one direct deployment file through the backend to Vercel
 * PUT /api/deployments/:id/files/:fileId/content
 */
router.put(
  '/:id/files/:fileId/content',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const idValidation = uuidParamSchema.safeParse(req.params.id);
      if (!idValidation.success) {
        throw new AppError('Invalid deployment ID', 400, ERROR_CODES.INVALID_INPUT);
      }

      const fileIdValidation = uuidParamSchema.safeParse(req.params.fileId);
      if (!fileIdValidation.success) {
        throw new AppError('Invalid deployment file ID', 400, ERROR_CODES.INVALID_INPUT);
      }

      const contentTypeHeader = req.headers['content-type'];
      const contentType = Array.isArray(contentTypeHeader)
        ? contentTypeHeader[0]
        : (contentTypeHeader ?? '');
      const normalizedContentType = contentType.split(';')[0].trim().toLowerCase();

      if (normalizedContentType !== 'application/octet-stream') {
        throw new AppError(
          'Deployment file content must be uploaded as application/octet-stream.',
          415,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const abortController = new AbortController();
      req.on('aborted', () => abortController.abort());
      res.on('close', () => {
        if (!res.writableEnded) {
          abortController.abort();
        }
      });

      const response = await deploymentService.uploadDeploymentFileContent(
        idValidation.data,
        fileIdValidation.data,
        req,
        {
          signal: abortController.signal,
        }
      );

      successResponse(res, response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Start a deployment after source files are available
 * POST /api/deployments/:id/start
 */
router.post(
  '/:id/start',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const validationResult = startDeploymentRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const deployment = await deploymentService.startDeployment(id, validationResult.data);

      // Log audit
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'START_DEPLOYMENT',
        module: 'DEPLOYMENTS',
        details: {
          id: deployment.id,
          providerDeploymentId: deployment.providerDeploymentId,
          provider: deployment.provider,
          status: deployment.status,
        },
        ip_address: req.ip,
      });

      successResponse(res, deployment);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * List all deployments
 * GET /api/deployments
 */
router.get('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const limit = Math.max(1, parseInt(req.query.limit as string) || 50);
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

    const { deployments, total } = await deploymentService.listDeployments(limit, offset);

    paginatedResponse(res, deployments, total, offset);
  } catch (error) {
    next(error);
  }
});

/**
 * Get deployment metadata (current deployment, domain URLs)
 * GET /api/deployments/metadata
 */
router.get(
  '/metadata',
  verifyAdmin,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const metadata = await deploymentService.getMetadata();
      successResponse(res, metadata);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Update custom slug for the project
 * PUT /api/deployments/slug
 */
router.put('/slug', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validationResult = updateSlugRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new AppError(
        validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const result = await deploymentService.updateSlug(validationResult.data.slug);

    // Log audit
    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'UPDATE_DEPLOYMENT_SLUG',
      module: 'DEPLOYMENTS',
      details: { slug: result.slug, domain: result.domain },
      ip_address: req.ip,
    });

    successResponse(res, result);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Custom Domain Routes (user-owned domains)
// ============================================================================

/**
 * List all custom domains
 * GET /api/deployments/domains
 */
router.get(
  '/domains',
  verifyAdmin,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await deploymentService.listCustomDomains();
      successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Add a custom domain
 * POST /api/deployments/domains
 */
router.post(
  '/domains',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validationResult = addCustomDomainRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const domain = await deploymentService.addCustomDomain(validationResult.data.domain);

      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'ADD_CUSTOM_DOMAIN',
        module: 'DEPLOYMENTS',
        details: { domain: domain.domain },
        ip_address: req.ip,
      });

      successResponse(res, domain, 201);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Verify a custom domain's DNS configuration
 * POST /api/deployments/domains/:domain/verify
 */
router.post(
  '/domains/:domain/verify',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validationResult = domainParamSchema.safeParse(req.params.domain);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((issue) => issue.message).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const result = await deploymentService.verifyCustomDomain(validationResult.data);
      successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Remove a custom domain
 * DELETE /api/deployments/domains/:domain
 */
router.delete(
  '/domains/:domain',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validationResult = domainParamSchema.safeParse(req.params.domain);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((issue) => issue.message).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const domain = validationResult.data;
      await deploymentService.removeCustomDomain(domain);

      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'REMOVE_CUSTOM_DOMAIN',
        module: 'DEPLOYMENTS',
        details: { domain },
        ip_address: req.ip,
      });

      successResponse(res, { success: true, message: `Domain ${domain} removed` });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Get deployment by database ID
 * GET /api/deployments/:id
 */
router.get('/:id', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const deployment = await deploymentService.getDeploymentById(id);

    if (!deployment) {
      throw new AppError(`Deployment not found: ${id}`, 404, ERROR_CODES.NOT_FOUND);
    }

    successResponse(res, deployment);
  } catch (error) {
    next(error);
  }
});

/**
 * Sync deployment status from Vercel and update database
 * POST /api/deployments/:id/sync
 */
router.post(
  '/:id/sync',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const deployment = await deploymentService.syncDeploymentById(id);

      if (!deployment) {
        throw new AppError(`Deployment not found: ${id}`, 404, ERROR_CODES.NOT_FOUND);
      }

      successResponse(res, deployment);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Cancel a deployment
 * POST /api/deployments/:id/cancel
 */
router.post(
  '/:id/cancel',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      await deploymentService.cancelDeploymentById(id);

      // Log audit
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'CANCEL_DEPLOYMENT',
        module: 'DEPLOYMENTS',
        details: { id },
        ip_address: req.ip,
      });

      successResponse(res, {
        success: true,
        message: `Deployment ${id} has been cancelled`,
      });
    } catch (error) {
      next(error);
    }
  }
);

export { router as deploymentsRouter };
