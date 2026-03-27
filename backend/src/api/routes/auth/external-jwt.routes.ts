import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ExternalJwtService } from '@/services/auth/external-jwt.service.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import { AuthRequest, verifyAdmin } from '@/api/middlewares/auth.js';

const router = Router();
const externalJwtService = ExternalJwtService.getInstance();
const auditService = AuditService.getInstance();

const claimMappingsSchema = z
  .object({
    sub: z.string().min(1),
    email: z.string().min(1),
  })
  .catchall(z.string());

const createProviderSchema = z.object({
  name: z.string().min(1).max(255),
  provider_key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_-]+$/, 'provider_key must be lowercase alphanumeric with hyphens/underscores'),
  issuer: z.string().min(1).max(2048),
  audience: z.string().max(2048).nullish(),
  jwks_url: z.string().url().max(2048),
  claim_mappings: claimMappingsSchema.optional(),
  default_role: z.enum(['anon', 'authenticated', 'project_admin']).optional(),
  subject_type: z.enum(['text', 'uuid']).optional(),
  is_enabled: z.boolean().optional(),
});

const updateProviderSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  issuer: z.string().min(1).max(2048).optional(),
  audience: z.string().max(2048).nullish(),
  jwks_url: z.string().url().max(2048).optional(),
  claim_mappings: claimMappingsSchema.optional(),
  default_role: z.enum(['anon', 'authenticated', 'project_admin']).optional(),
  subject_type: z.enum(['text', 'uuid']).optional(),
  is_enabled: z.boolean().optional(),
});

// All routes require admin authentication
router.use(verifyAdmin);

// GET /api/auth/jwt-providers - List all external JWT providers
router.get('/', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const providers = await externalJwtService.listProviders();
    successResponse(res, { providers });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/jwt-providers/:providerKey - Get a specific provider
router.get('/:providerKey', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const provider = await externalJwtService.getProviderByKey(req.params.providerKey);
    if (!provider) {
      throw new AppError('JWT provider not found', 404, ERROR_CODES.NOT_FOUND);
    }
    successResponse(res, provider);
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/jwt-providers - Create a new external JWT provider
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validationResult = createProviderSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new AppError(
        validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const provider = await externalJwtService.createProvider(validationResult.data);

    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'CREATE_JWT_PROVIDER',
      module: 'AUTH',
      details: {
        provider_key: provider.provider_key,
        issuer: provider.issuer,
      },
      ip_address: req.ip,
    });

    successResponse(res, provider, 201);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/auth/jwt-providers/:providerKey - Update an existing provider
router.patch('/:providerKey', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validationResult = updateProviderSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new AppError(
        validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const provider = await externalJwtService.updateProvider(
      req.params.providerKey,
      validationResult.data
    );

    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'UPDATE_JWT_PROVIDER',
      module: 'AUTH',
      details: {
        provider_key: provider.provider_key,
        updatedFields: Object.keys(validationResult.data),
      },
      ip_address: req.ip,
    });

    successResponse(res, provider);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/auth/jwt-providers/:providerKey - Delete a provider
router.delete('/:providerKey', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await externalJwtService.deleteProvider(req.params.providerKey);

    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'DELETE_JWT_PROVIDER',
      module: 'AUTH',
      details: {
        provider_key: req.params.providerKey,
      },
      ip_address: req.ip,
    });

    successResponse(res, { message: 'JWT provider deleted successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;
