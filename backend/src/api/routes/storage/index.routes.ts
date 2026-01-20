import { Router, Request, Response, NextFunction } from 'express';
import { verifyAdmin, AuthRequest, verifyUser } from '@/api/middlewares/auth.js';
import { AppError } from '@/api/middlewares/error.js';
import { StorageService } from '@/services/storage/storage.service.js';
import { successResponse } from '@/utils/response.js';
import { upload, handleUploadError } from '@/api/middlewares/upload.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { createBucketRequestSchema, updateBucketRequestSchema } from '@insforge/shared-schemas';
import { SocketManager } from '@/infra/socket/socket.manager.js';
import { DataUpdateResourceType, ServerEvents } from '@/types/socket.js';
import { AuditService } from '@/services/logs/audit.service.js';

const router = Router();
const auditService = AuditService.getInstance();

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

      const socket = SocketManager.getInstance();
      socket.broadcastToRoom(
        'role:project_admin',
        ServerEvents.DATA_UPDATE,
        { resource: DataUpdateResourceType.BUCKETS, data: { bucketName } },
        'system'
      );

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

// GET /api/storage/buckets/:bucketName/objects - List objects in bucket (requires auth)
router.get(
  '/buckets/:bucketName/objects',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { bucketName } = req.params;
      const prefix = req.query.prefix as string;
      const searchQuery = req.query.search as string;
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
      const offset = parseInt(req.query.offset as string) || 0;

      const storageService = StorageService.getInstance();
      const result = await storageService.listObjects(
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
  upload.single('file'),
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
      const storageService = StorageService.getInstance();
      const storedFile = await storageService.putObject(
        bucketName,
        objectKey,
        req.file,
        req.user?.id,
        req.user?.role
      );

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

      const result = await storageService.getObject(bucketName, objectKey);
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

      // Delete specific object (RLS policies applied via user context)
      const storageService = StorageService.getInstance();
      const deleted = await storageService.deleteObject(
        bucketName,
        objectKey,
        req.user?.id,
        req.user?.role
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

      const storageService = StorageService.getInstance();
      const strategy = await storageService.getUploadStrategy(bucketName, {
        filename,
        contentType,
        size,
      });

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
        req.user?.id,
        req.user?.role
      );

      successResponse(res, fileInfo, 201);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        next(new AppError(error.message, 404, ERROR_CODES.NOT_FOUND));
      } else if (error instanceof Error && error.message.includes('already confirmed')) {
        next(new AppError(error.message, 409, ERROR_CODES.ALREADY_EXISTS));
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
export { router as storageRouter };
