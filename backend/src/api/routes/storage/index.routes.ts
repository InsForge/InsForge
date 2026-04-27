import { Router, Request, Response, NextFunction } from 'express';
import { verifyAdmin, AuthRequest, verifyUser } from '@/api/middlewares/auth.js';
import { AppError } from '@/api/middlewares/error.js';
import { StorageService } from '@/services/storage/storage.service.js';
import { StorageConfigService } from '@/services/storage/storage-config.service.js';
import { successResponse } from '@/utils/response.js';
import { dynamicUploadSingle, handleUploadError } from '@/api/middlewares/upload.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import {
  createBucketRequestSchema,
  updateBucketRequestSchema,
  updateStorageConfigRequestSchema,
  createS3AccessKeyRequestSchema,
} from '@insforge/shared-schemas';
import { SocketManager } from '@/infra/socket/socket.manager.js';
import { DataUpdateResourceType, ServerEvents } from '@/types/socket.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { S3AccessKeyService } from '@/services/storage/s3-access-key.service.js';
import { s3AccessKeyManagementRateLimiter } from '@/api/middlewares/rate-limiters.js';
import { UserContext } from '@/services/db/user-context.service.js';

/**
 * Build a UserContext from the authenticated request. Admin = API key or
 * the project_admin role; everyone else runs as `authenticated` with their
 * `sub` claim plumbed through to RLS.
 */
function authedContext(req: AuthRequest): UserContext {
  const isAdmin = !!req.apiKey || req.user?.role === 'project_admin';
  return {
    isAdmin,
    userId: req.user?.id,
    email: req.user?.email,
    role: 'authenticated',
  };
}

const router = Router();
const auditService = AuditService.getInstance();
const storageConfigService = StorageConfigService.getInstance();
const s3AccessKeyService = S3AccessKeyService.getInstance();

// Middleware to conditionally apply authentication based on bucket visibility
const conditionalAuth = async (req: Request, res: Response, next: NextFunction) => {
  // For GET and HEAD requests to download objects, check if bucket is public
  if ((req.method === 'GET' || req.method === 'HEAD') && req.params.bucketName) {
    try {
      const storageService = StorageService.getInstance();
      const isPublic = await storageService.isBucketPublic(req.params.bucketName);

      if (isPublic) {
        // Public bucket - skip authentication
        return next();
      }
    } catch {
      // If error checking bucket, continue with auth requirement
    }
  }

  // All other cases require authentication
  return verifyUser(req, res, next);
};

// GET /api/storage/config - Get storage configuration (requires admin)
router.get('/config', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const config = await storageConfigService.getStorageConfig();
    successResponse(res, config);
  } catch (error) {
    next(error);
  }
});

// PUT /api/storage/config - Update storage configuration (requires admin)
router.put('/config', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = updateStorageConfigRequestSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const config = await storageConfigService.updateStorageConfig(validation.data);

    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'UPDATE_STORAGE_CONFIG',
      module: 'STORAGE',
      details: { updatedFields: Object.keys(validation.data) },
      ip_address: req.ip,
    });

    successResponse(res, config);
  } catch (error) {
    next(error);
  }
});

// GET /api/storage/buckets - List all buckets (requires admin)
router.get('/buckets', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const storageService = StorageService.getInstance();
    const buckets = await storageService.listBuckets();

    successResponse(res, buckets);
  } catch (error) {
    next(error);
  }
});

// POST /api/storage/buckets - Create a new bucket (requires admin)
router.post(
  '/buckets',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validation = createBucketRequestSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.STORAGE_INVALID_PARAMETER,
          'Please check the request body, it must conform with the CreateBucketRequest schema.'
        );
      }
      const { bucketName, isPublic } = validation.data;

      const storageService = StorageService.getInstance();
      await storageService.createBucket(bucketName, isPublic);

      // Log audit for bucket creation
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'CREATE_BUCKET',
        module: 'STORAGE',
        details: {
          bucketName,
          isPublic,
        },
        ip_address: req.ip,
      });

      const socket = SocketManager.getInstance();
      socket.broadcastToRoom(
        'role:project_admin',
        ServerEvents.DATA_UPDATE,
        { resource: DataUpdateResourceType.BUCKETS },
        'system'
      );

      const accessInfo = isPublic
        ? 'This is a PUBLIC bucket - objects can be accessed without authentication.'
        : 'This is a PRIVATE bucket - authentication is required to access objects.';

      successResponse(
        res,
        {
          message: 'Bucket created successfully',
          bucketName,
          isPublic: isPublic,
          nextActions: `${accessInfo} You can use /api/storage/buckets/:bucketName/objects/:objectKey to upload an object to the bucket, and /api/storage/buckets/:bucketName/objects to list the objects in the bucket.`,
        },
        201
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        next(new AppError(error.message, 409, ERROR_CODES.ALREADY_EXISTS));
      } else if (error instanceof Error && error.message.includes('Invalid bucket name')) {
        next(
          new AppError(
            error.message,
            400,
            ERROR_CODES.STORAGE_INVALID_PARAMETER,
            'Please check the bucket name, it must be a valid bucket name'
          )
        );
      } else {
        next(error);
      }
    }
  }
);

// PATCH /api/storage/buckets/:bucketName - Update bucket (requires auth)
router.patch(
  '/buckets/:bucketName',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { bucketName } = req.params;
      const validation = updateBucketRequestSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.STORAGE_INVALID_PARAMETER,
          'Please check the request body, it must conform with the UpdateBucketRequest schema.'
        );
      }
      const { isPublic } = validation.data;

      const storageService = StorageService.getInstance();
      await storageService.updateBucketVisibility(bucketName, isPublic);

      // Log audit for bucket update
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'UPDATE_BUCKET',
        module: 'STORAGE',
        details: {
          bucketName,
          isPublic,
        },
        ip_address: req.ip,
      });

      try {
        const socket = SocketManager.getInstance();
        socket.broadcastToRoom(
          'role:project_admin',
          ServerEvents.DATA_UPDATE,
          { resource: DataUpdateResourceType.BUCKETS, data: { bucketName } },
          'system'
        );
      } catch {
        // Best-effort notification; do not fail completed storage mutation
      }

      const accessInfo = isPublic
        ? 'Bucket is now PUBLIC - objects can be accessed without authentication.'
        : 'Bucket is now PRIVATE - authentication is required to access objects.';

      successResponse(
        res,
        {
          message: 'Bucket visibility updated',
          bucket: bucketName,
          isPublic: isPublic,
          nextActions: accessInfo,
        },
        200
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('does not exist')) {
        next(new AppError(error.message, 404, ERROR_CODES.NOT_FOUND));
      } else {
        next(error);
      }
    }
  }
);

// GET /api/storage/buckets/:bucketName/objects - List objects in bucket.
// Visibility is decided by RLS on storage.objects: admin (apiKey /
// project_admin) bypasses, authenticated callers see only rows their
// policies allow.
router.get(
  '/buckets/:bucketName/objects',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { bucketName } = req.params;
      const prefix = req.query.prefix as string;
      const searchQuery = req.query.search as string;
      const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 100), 1000);
      const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

      const result = await StorageService.getInstance().listObjects(
        authedContext(req),
        bucketName,
        prefix,
        limit,
        offset,
        searchQuery
      );

      successResponse(
        res,
        {
          data: result.objects,
          pagination: {
            offset: offset,
            limit: limit,
            total: result.total,
          },
          nextActions:
            'You can use PUT /api/storage/buckets/:bucketName/objects/:objectKey to upload with a specific key, or POST /api/storage/buckets/:bucketName/objects to upload with auto-generated key, and GET /api/storage/buckets/:bucketName/objects/:objectKey to download an object.',
        },
        200
      );
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/storage/buckets/:bucketName/objects/:objectKey - Upload object to bucket (requires auth)
router.put(
  '/buckets/:bucketName/objects/*',
  verifyUser,
  dynamicUploadSingle('file'),
  handleUploadError,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { bucketName } = req.params;
      const objectKey = req.params[0]; // Everything after objects

      if (!objectKey) {
        throw new AppError('Object key is required', 400, ERROR_CODES.STORAGE_INVALID_PARAMETER);
      }

      if (!req.file) {
        throw new AppError('File is required', 400, ERROR_CODES.STORAGE_INVALID_PARAMETER);
      }

      const storedFile = await StorageService.getInstance().putObject(
        authedContext(req),
        bucketName,
        objectKey,
        req.file
      );

      try {
        const socket = SocketManager.getInstance();
        socket.broadcastToRoom(
          'role:project_admin',
          ServerEvents.DATA_UPDATE,
          { resource: DataUpdateResourceType.BUCKETS, data: { bucketName } },
          'system'
        );
      } catch {
        // Best-effort notification; do not fail completed storage mutation
      }

      successResponse(res, storedFile, 201);
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        next(new AppError(error.message, 409, ERROR_CODES.ALREADY_EXISTS));
      } else if (error instanceof Error && error.message.includes('Invalid')) {
        next(new AppError(error.message, 400, ERROR_CODES.STORAGE_INVALID_PARAMETER));
      } else {
        next(error);
      }
    }
  }
);

// POST /api/storage/buckets/:bucketName/objects - Upload object with server-generated key (requires auth)
router.post(
  '/buckets/:bucketName/objects',
  verifyUser,
  dynamicUploadSingle('file'),
  handleUploadError,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { bucketName } = req.params;

      if (!req.file) {
        throw new AppError('File is required', 400, ERROR_CODES.STORAGE_INVALID_PARAMETER);
      }

      const storageService = StorageService.getInstance();

      // Generate a unique key for the object using service
      const objectKey = storageService.generateObjectKey(req.file.originalname);

      const storedFile = await storageService.putObject(
        authedContext(req),
        bucketName,
        objectKey,
        req.file
      );

      try {
        const socket = SocketManager.getInstance();
        socket.broadcastToRoom(
          'role:project_admin',
          ServerEvents.DATA_UPDATE,
          { resource: DataUpdateResourceType.BUCKETS, data: { bucketName } },
          'system'
        );
      } catch {
        // Best-effort notification; do not fail completed storage mutation
      }

      successResponse(res, storedFile, 201);
    } catch (error) {
      if (error instanceof Error && error.message.includes('does not exist')) {
        next(
          new AppError(
            'Bucket does not exist',
            404,
            ERROR_CODES.NOT_FOUND,
            'Create the bucket first using POST /api/storage/buckets'
          )
        );
      } else if (error instanceof Error && error.message.includes('Invalid')) {
        next(new AppError(error.message, 400, ERROR_CODES.STORAGE_INVALID_PARAMETER));
      } else {
        next(error);
      }
    }
  }
);

// GET /api/storage/buckets/:bucketName/objects/:objectKey - Download object from bucket (conditional auth)
router.get(
  '/buckets/:bucketName/objects/*',
  conditionalAuth,
  async (req: AuthRequest | Request, res: Response, next: NextFunction) => {
    try {
      const { bucketName } = req.params;
      const objectKey = req.params[0]; // Everything after objects

      if (!objectKey) {
        throw new AppError('Object key is required', 400, ERROR_CODES.STORAGE_INVALID_PARAMETER);
      }

      const storageService = StorageService.getInstance();

      // Get download strategy (service auto-calculates expiry based on bucket visibility)
      const strategy = await storageService.getDownloadStrategy(bucketName, objectKey);

      if (strategy.method === 'presigned') {
        return res.redirect(strategy.url);
      }

      // conditionalAuth either confirmed a public bucket (no req.user) or
      // required auth. For the public-bucket case we run as admin to bypass
      // RLS, preserving the prior behavior; otherwise RLS evaluates.
      const authReq = req as AuthRequest;
      const ctx: UserContext =
        !authReq.user && !authReq.apiKey
          ? { isAdmin: true, role: 'authenticated' }
          : authedContext(authReq);
      const result = await storageService.getObject(ctx, bucketName, objectKey);
      if (!result) {
        throw new AppError('Object not found', 404, ERROR_CODES.NOT_FOUND);
      }

      const { file, metadata } = result;

      // Set appropriate headers
      res.setHeader('Content-Type', metadata.mimeType || 'application/octet-stream');
      res.setHeader('Content-Length', file.length.toString());

      // Send object content
      res.send(file);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid')) {
        next(new AppError(error.message, 400, ERROR_CODES.STORAGE_INVALID_PARAMETER));
      } else {
        next(error);
      }
    }
  }
);

// DELETE /api/storage/buckets/:bucketName - Delete entire bucket (requires auth)
router.delete(
  '/buckets/:bucketName',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { bucketName } = req.params;
      const storageService = StorageService.getInstance();
      const deleted = await storageService.deleteBucket(bucketName);

      if (!deleted) {
        throw new AppError('Bucket not found or already empty', 404, ERROR_CODES.NOT_FOUND);
      }

      // Log audit for bucket deletion
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'DELETE_BUCKET',
        module: 'STORAGE',
        details: {
          bucketName,
        },
        ip_address: req.ip,
      });

      const socket = SocketManager.getInstance();
      socket.broadcastToRoom(
        'role:project_admin',
        ServerEvents.DATA_UPDATE,
        { resource: DataUpdateResourceType.BUCKETS },
        'system'
      );

      successResponse(
        res,
        {
          message: 'Bucket deleted successfully',
          nextActions:
            'You can use POST /api/storage/buckets to create a new bucket, and GET /api/storage/buckets/:bucketName/objects to list the objects in the bucket.',
        },
        200
      );
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/storage/buckets/:bucketName/objects/:objectKey - Delete object from bucket (requires auth)
router.delete(
  '/buckets/:bucketName/objects/*',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { bucketName } = req.params;
      const objectKey = req.params[0]; // Everything after objects

      if (!objectKey) {
        throw new AppError('Object key is required', 400, ERROR_CODES.STORAGE_INVALID_PARAMETER);
      }

      const deleted = await StorageService.getInstance().deleteObject(
        authedContext(req),
        bucketName,
        objectKey
      );

      if (!deleted) {
        throw new AppError('Object not found', 404, ERROR_CODES.NOT_FOUND);
      }

      successResponse(res, { message: 'Object deleted successfully' });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid')) {
        next(new AppError(error.message, 400, ERROR_CODES.STORAGE_INVALID_PARAMETER));
      } else {
        next(error);
      }
    }
  }
);

// POST /api/storage/buckets/:bucketName/upload-strategy - Get upload strategy (presigned or direct)
router.post(
  '/buckets/:bucketName/upload-strategy',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { bucketName } = req.params;
      const { filename, contentType, size } = req.body;

      if (!filename) {
        throw new AppError('Filename is required', 400, ERROR_CODES.STORAGE_INVALID_PARAMETER);
      }

      const strategy = await StorageService.getInstance().getUploadStrategy(
        authedContext(req),
        bucketName,
        { filename, contentType, size }
      );

      successResponse(res, strategy);
    } catch (error) {
      if (error instanceof Error && error.message.includes('does not exist')) {
        next(new AppError(error.message, 404, ERROR_CODES.NOT_FOUND));
      } else {
        next(error);
      }
    }
  }
);

// POST /api/storage/buckets/:bucketName/objects/:objectKey/confirm-upload - Confirm presigned upload
router.post(
  '/buckets/:bucketName/objects/:objectKey/confirm-upload',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { bucketName, objectKey } = req.params;
      const { size, contentType, etag } = req.body;

      if (!size) {
        throw new AppError('Size is required', 400, ERROR_CODES.STORAGE_INVALID_PARAMETER);
      }

      const storageService = StorageService.getInstance();
      const fileInfo = await storageService.confirmUpload(
        bucketName,
        objectKey,
        {
          size,
          contentType,
          etag,
        },
        req.user?.id
      );

      try {
        const socket = SocketManager.getInstance();
        socket.broadcastToRoom(
          'role:project_admin',
          ServerEvents.DATA_UPDATE,
          { resource: DataUpdateResourceType.BUCKETS, data: { bucketName } },
          'system'
        );
      } catch {
        // Best-effort notification; do not fail completed storage mutation
      }

      successResponse(res, fileInfo, 201);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        next(new AppError(error.message, 404, ERROR_CODES.NOT_FOUND));
      } else if (error instanceof Error && error.message.includes('already confirmed')) {
        next(new AppError(error.message, 409, ERROR_CODES.ALREADY_EXISTS));
      } else if (
        error instanceof Error &&
        error.message.includes('exceeds the configured maximum')
      ) {
        next(new AppError(error.message, 413, ERROR_CODES.STORAGE_INVALID_PARAMETER));
      } else {
        next(error);
      }
    }
  }
);

// POST /api/storage/buckets/:bucketName/objects/:objectKey/download-strategy - Get download URL (presigned or direct)
router.post(
  '/buckets/:bucketName/objects/:objectKey/download-strategy',
  conditionalAuth,
  async (req: AuthRequest | Request, res: Response, next: NextFunction) => {
    try {
      const { bucketName, objectKey } = req.params;

      const storageService = StorageService.getInstance();
      const strategy = await storageService.getDownloadStrategy(bucketName, objectKey);

      successResponse(res, strategy);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid')) {
        next(new AppError(error.message, 400, ERROR_CODES.STORAGE_INVALID_PARAMETER));
      } else {
        next(error);
      }
    }
  }
);
// ============================================================================
// S3 Protocol — Gateway Config + Access Key Management (admin only)
// Per-IP rate limiting applied across all three access-key endpoints since
// they mint / revoke long-lived credentials.
// ============================================================================

// GET /api/storage/s3/config - Return the gateway endpoint + signing region.
// Endpoint is assembled from VITE_API_BASE_URL (the externally-reachable base
// URL clients use for this backend) plus the fixed /storage/v1/s3 path. The
// signing region is the value the SigV4 middleware validates against; clients
// must sign with exactly this value.
router.get('/s3/config', verifyAdmin, (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const base = (process.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
    const endpoint = base ? `${base}/storage/v1/s3` : '/storage/v1/s3';
    const region = process.env.AWS_REGION || 'us-east-2';
    successResponse(res, { endpoint, region });
  } catch (error) {
    next(error);
  }
});

// POST /api/storage/s3/access-keys - Create a new access key. Plaintext secret
// is returned ONCE in the response and never again.
router.post(
  '/s3/access-keys',
  s3AccessKeyManagementRateLimiter,
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validation = createS3AccessKeyRequestSchema.safeParse(req.body ?? {});
      if (!validation.success) {
        throw new AppError(
          validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.STORAGE_INVALID_PARAMETER
        );
      }
      const result = await s3AccessKeyService.create(validation.data);
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'CREATE_S3_ACCESS_KEY',
        module: 'STORAGE',
        details: { accessKeyId: result.accessKeyId },
        ip_address: req.ip,
      });
      successResponse(res, result, 201);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/storage/s3/access-keys - List all access keys (no secrets)
router.get(
  '/s3/access-keys',
  s3AccessKeyManagementRateLimiter,
  verifyAdmin,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const keys = await s3AccessKeyService.list();
      successResponse(res, keys);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/storage/s3/access-keys/:id - Revoke an access key
router.delete(
  '/s3/access-keys/:id',
  s3AccessKeyManagementRateLimiter,
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await s3AccessKeyService.delete(req.params.id);
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'DELETE_S3_ACCESS_KEY',
        module: 'STORAGE',
        details: { id: req.params.id },
        ip_address: req.ip,
      });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

export { router as storageRouter };
