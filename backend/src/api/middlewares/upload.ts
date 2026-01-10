import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { ProcessedFormData } from '@/types/storage.js';
import { StorageService } from '@/services/storage/storage.service.js';

// Constants
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_MAX_FILES = 10;

/**
 * Get the maximum file size for a bucket
 * Returns bucket-specific limit if set, otherwise global limit
 * @internal - exported for testing purposes
 */
export async function getMaxFileSizeForBucket(bucketName?: string): Promise<number> {
  if (!bucketName) {
    return parseInt(process.env.MAX_FILE_SIZE || '') || DEFAULT_MAX_FILE_SIZE;
  }

  const storageService = StorageService.getInstance();
  const bucketMaxSize = await storageService.getBucketMaxFileSize(bucketName);

  // If bucket has a specific limit, use it; otherwise use global limit
  return bucketMaxSize ?? (parseInt(process.env.MAX_FILE_SIZE || '') || DEFAULT_MAX_FILE_SIZE);
}

/**
 * Create upload middleware with bucket-specific file size limit
 * This middleware checks the bucket's max_file_size setting before applying multer limits
 */
export function createBucketUploadMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const bucketName = req.params?.bucketName;
      const maxFileSize = await getMaxFileSizeForBucket(bucketName);

      // Create multer instance with bucket-specific limit
      const upload = multer({
        storage: multer.memoryStorage(),
        limits: {
          fileSize: maxFileSize,
          files: parseInt(process.env.MAX_FILES_PER_FIELD || '') || DEFAULT_MAX_FILES,
        },
      });

      // Apply the upload middleware
      return upload.single('file')(req, res, (err) => {
        if (err) {
          return handleUploadError(err, req, res, next);
        }
        next();
      });
    } catch (error) {
      return next(error);
    }
  };
}

// Create multer instance with memory storage (default, for backward compatibility)
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '') || DEFAULT_MAX_FILE_SIZE,
    files: parseInt(process.env.MAX_FILES_PER_FIELD || '') || DEFAULT_MAX_FILES,
  },
});

// Middleware to handle file upload errors
export const handleUploadError = (
  err: Error | multer.MulterError,
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  if (err instanceof multer.MulterError) {
    const errorMap: Record<string, { status: number; message: string }> = {
      LIMIT_FILE_SIZE: {
        status: 413,
        message: 'File exceeds the maximum allowed size for this bucket',
      },
      LIMIT_FILE_COUNT: { status: 400, message: 'Too many files' },
    };

    const error = errorMap[err.code] || { status: 400, message: err.message };
    return next(new AppError(error.message, error.status, ERROR_CODES.STORAGE_INVALID_PARAMETER));
  }

  if (err) {
    return next(new AppError(err.message, 500, ERROR_CODES.INTERNAL_ERROR));
  }

  next();
};

// Helper to process form data

export function processFormData(req: Request): ProcessedFormData {
  const fields = req.body || {};
  const files: Record<string, Express.Multer.File[]> = {};

  if (req.files) {
    if (Array.isArray(req.files)) {
      files['files'] = req.files;
    } else {
      Object.assign(files, req.files);
    }
  }

  return { fields, files };
}
