import { Router, Request, Response, NextFunction } from 'express';
import path from 'path';
import { verifyApiKey, AuthRequest } from '@/api/middleware/auth.js';
import { AppError } from '@/api/middleware/error.js';
import { StorageService } from '@/core/storage/storage.js';
import { DatabaseManager } from '@/core/database/database.js';
import { successResponse } from '@/utils/response.js';
import { upload, handleUploadError } from '@/api/middleware/upload.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { BucketInfo } from '@/types/storage.js';

const router = Router();

// Middleware to conditionally apply authentication based on bucket visibility
const conditionalAuth = async (req: Request, res: Response, next: NextFunction) => {
  // For GET and HEAD requests to download objects, check if bucket is public
  if ((req.method === 'GET' || req.method === 'HEAD') && req.params.bucket) {
    try {
      const storageService = StorageService.getInstance();
      const isPublic = await storageService.isBucketPublic(req.params.bucket);

      if (isPublic) {
        // Public bucket - skip authentication
        return next();
      }
    } catch {
      // If error checking bucket, continue with auth requirement
    }
  }

  // All other cases require authentication
  return verifyApiKey(req, res, next);
};

// GET /api/storage/buckets - List all buckets (requires auth)
router.get(
  '/buckets',
  verifyApiKey,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const db = DatabaseManager.getInstance().getDb();

      // Get all buckets with their metadata from _storage_buckets table
      const buckets = (await db
        .prepare('SELECT name, public, created_at FROM _storage_buckets ORDER BY name')
        .all()) as BucketInfo[];

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
  verifyApiKey,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { bucket, public: isPublic = true } = req.body;

      if (!bucket) {
        throw new AppError(
          'Bucket name is required',
          400,
          ERROR_CODES.STORAGE_INVALID_PARAMETER,
          'Please check the bucket name, it must be a valid bucket name'
        );
      }

      const storageService = StorageService.getInstance();
      await storageService.createBucket(bucket, isPublic);

      const accessInfo = isPublic
        ? 'This is a PUBLIC bucket - files can be accessed without authentication.'
        : 'This is a PRIVATE bucket - authentication is required to access files.';

      successResponse(
        res,
        {
          message: 'Bucket created successfully',
          bucket,
          public: isPublic,
          nextAction: `${accessInfo} You can use /api/storage/:bucket/:key to upload a file to the bucket, and /api/storage/:bucket to list the files in the bucket.`,
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

// PATCH /api/storage/buckets/:bucket - Update bucket visibility (requires auth)
router.patch(
  '/buckets/:bucket',
  verifyApiKey,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { bucket } = req.params;
      const { public: isPublic } = req.body;

      if (typeof isPublic !== 'boolean') {
        throw new AppError(
          'Public flag must be a boolean',
          400,
          ERROR_CODES.STORAGE_INVALID_PARAMETER
        );
      }

      const storageService = StorageService.getInstance();
      await storageService.updateBucketVisibility(bucket, isPublic);

      const accessInfo = isPublic
        ? 'Bucket is now PUBLIC - files can be accessed without authentication.'
        : 'Bucket is now PRIVATE - authentication is required to access files.';

      successResponse(
        res,
        {
          message: 'Bucket visibility updated',
          bucket,
          public: isPublic,
          nextAction: accessInfo,
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

// GET /api/storage/:bucket - List objects in bucket (requires auth)
router.get(
  '/:bucket',
  verifyApiKey,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { bucket } = req.params;
      const prefix = req.query.prefix as string;
      const searchQuery = req.query.search as string;
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
      const offset = parseInt(req.query.offset as string) || 0;

      const storageService = StorageService.getInstance();
      const result = await storageService.listObjects(bucket, prefix, limit, offset, searchQuery);

      successResponse(
        res,
        {
          bucket,
          prefix,
          objects: result.objects,
          pagination: {
            limit,
            offset,
            total: result.total,
          },
          nextAction:
            'You can use PUT /api/storage/:bucket/:key to upload with a specific key, or POST /api/storage/:bucket to upload with auto-generated key, and GET /api/storage/:bucket/:key to download a file.',
        },
        200
      );
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/storage/:bucket/:key - Upload object to bucket (requires auth)
router.put(
  '/:bucket/*',
  verifyApiKey,
  upload.single('file'),
  handleUploadError,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { bucket } = req.params;
      const key = req.params[0]; // Everything after bucket

      if (!key) {
        throw new AppError('Object key is required', 400, ERROR_CODES.STORAGE_INVALID_PARAMETER);
      }

      if (!req.file) {
        throw new AppError('File is required', 400, ERROR_CODES.STORAGE_INVALID_PARAMETER);
      }

      const storageService = StorageService.getInstance();
      const storedFile = await storageService.putObject(bucket, key, req.file);

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

// POST /api/storage/:bucket - Upload object with server-generated key (requires auth)
router.post(
  '/:bucket',
  verifyApiKey,
  upload.single('file'),
  handleUploadError,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { bucket } = req.params;

      if (!req.file) {
        throw new AppError('File is required', 400, ERROR_CODES.STORAGE_INVALID_PARAMETER);
      }

      // Generate a unique key for the file
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).substring(2, 8);
      const fileExt = req.file.originalname ? path.extname(req.file.originalname) : '';
      const baseName = req.file.originalname
        ? path.basename(req.file.originalname, fileExt)
        : 'file';
      const sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9-_]/g, '-').substring(0, 32);
      const key = `${sanitizedBaseName}-${timestamp}-${randomStr}${fileExt}`;

      const storageService = StorageService.getInstance();
      const storedFile = await storageService.putObject(bucket, key, req.file);

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

// GET /api/storage/:bucket/:key - Download object from bucket (conditional auth)
router.get(
  '/:bucket/*',
  conditionalAuth,
  async (req: AuthRequest | Request, res: Response, next: NextFunction) => {
    try {
      const { bucket } = req.params;
      const key = req.params[0]; // Everything after bucket

      if (!key) {
        throw new AppError('Object key is required', 400, ERROR_CODES.STORAGE_INVALID_PARAMETER);
      }

      const storageService = StorageService.getInstance();
      const result = await storageService.getObject(bucket, key);

      if (!result) {
        throw new AppError('Object not found', 404, ERROR_CODES.NOT_FOUND);
      }

      const { file, metadata } = result;

      // Set appropriate headers
      res.setHeader('Content-Type', metadata.mime_type || 'application/octet-stream');
      res.setHeader('Content-Length', file.length.toString());

      // Send file
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

// DELETE /api/storage/:bucket - Delete entire bucket (requires auth)
router.delete(
  '/:bucket',
  verifyApiKey,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { bucket } = req.params;
      const storageService = StorageService.getInstance();
      const deleted = await storageService.deleteBucket(bucket);

      if (!deleted) {
        throw new AppError('Bucket not found or already empty', 404, ERROR_CODES.NOT_FOUND);
      }

      successResponse(
        res,
        {
          message: 'Bucket deleted successfully',
          nextAction:
            'You can use POST /api/storage/buckets to create a new bucket, and GET /api/storage/:bucket to list the files in the bucket.',
        },
        200
      );
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/storage/:bucket/:key - Delete object from bucket (requires auth)
router.delete(
  '/:bucket/*',
  verifyApiKey,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { bucket } = req.params;
      const key = req.params[0]; // Everything after bucket

      if (!key) {
        throw new AppError('Object key is required', 400, ERROR_CODES.STORAGE_INVALID_PARAMETER);
      }

      // Delete specific object
      const storageService = StorageService.getInstance();
      const deleted = await storageService.deleteObject(bucket, key);

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
