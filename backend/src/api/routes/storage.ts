import { Router, Request, Response, NextFunction } from 'express';
import path from 'path';
import { verifyAdmin, AuthRequest, verifyUser } from '@/api/middleware/auth.js';
import { AppError } from '@/api/middleware/error.js';
import { StorageService } from '@/core/storage/storage.js';
import { DatabaseManager } from '@/core/database/database.js';
import { successResponse } from '@/utils/response.js';
import { upload, handleUploadError } from '@/api/middleware/upload.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import {
  StorageBucketSchema,
  createBucketRequestSchema,
  updateBucketRequestSchema,
} from '@insforge/shared-schemas';

const router = Router();

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

// GET /api/storage/buckets - List all buckets (requires auth)
router.get(
  '/buckets',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const db = DatabaseManager.getInstance().getDb();

      // Get all buckets with their metadata from _storage_buckets table
      const buckets = (await db
        .prepare('SELECT name, public, created_at FROM _storage_buckets ORDER BY name')
        .all()) as StorageBucketSchema[];

      // Traditional REST: return array directly
      successResponse(res, buckets);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/storage/buckets - Create a new bucket (requires auth)
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
          bucketName: bucketName,
          prefix,
          objects: result.objects,
          pagination: {
            limit,
            offset,
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
      const storedFile = await storageService.putObject(bucketName, objectKey, req.file);

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
  upload.single('file'),
  handleUploadError,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { bucketName } = req.params;

      if (!req.file) {
        throw new AppError('File is required', 400, ERROR_CODES.STORAGE_INVALID_PARAMETER);
      }

      // Generate a unique key for the object
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).substring(2, 8);
      const fileExt = req.file.originalname ? path.extname(req.file.originalname) : '';
      const baseName = req.file.originalname
        ? path.basename(req.file.originalname, fileExt)
        : 'file';
      const sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9-_]/g, '-').substring(0, 32);
      const objectKey = `${sanitizedBaseName}-${timestamp}-${randomStr}${fileExt}`;

      const storageService = StorageService.getInstance();
      const storedFile = await storageService.putObject(bucketName, objectKey, req.file);

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

      // TODO: we need add more policies to check if user has permission to delete this object
      // For now, we assume user has permission if they can access the bucket

      // Delete specific object
      const storageService = StorageService.getInstance();
      const deleted = await storageService.deleteObject(bucketName, objectKey);

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

export { router as storageRouter };
