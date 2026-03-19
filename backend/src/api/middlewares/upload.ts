import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { ProcessedFormData } from '@/types/storage.js';
import { StorageConfigService } from '@/services/storage/storage-config.service.js';
import logger from '@/utils/logger.js';

// Constants
const DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const DEFAULT_MAX_FILES = 10;

/**
 * Returns the configured max file size in bytes.
 * Uses the MAX_FILE_SIZE environment variable if set, otherwise defaults to 50 MB.
 */
export const getMaxFileSize = (): number =>
  parseInt(process.env.MAX_FILE_SIZE || '') || DEFAULT_MAX_FILE_SIZE;

// Create multer instance with memory storage (static, env-based — used by non-storage routes)
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: getMaxFileSize(),
    files: parseInt(process.env.MAX_FILES_PER_FIELD || '') || DEFAULT_MAX_FILES,
  },
});

/**
 * Creates a per-request multer single-file upload middleware that reads the
 * configured max file size from the storage config table at request time.
 * Falls back to the env-based limit when the database is unreachable.
 */
export const dynamicUploadSingle =
  (fieldName: string) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let maxSize: number;
    try {
      maxSize = await StorageConfigService.getInstance().getMaxFileSizeBytes();
    } catch (error) {
      // Fall back to env-based limit when the DB is unreachable
      logger.warn('Could not read storage config from DB, falling back to env/default', { error });
      maxSize = getMaxFileSize();
    }

    // Attach the resolved limit to the request so handleUploadError can reference it
    (req as Request & { _maxFileSizeBytes?: number })._maxFileSizeBytes = maxSize;

    const uploader = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: maxSize,
        files: parseInt(process.env.MAX_FILES_PER_FIELD || '') || DEFAULT_MAX_FILES,
      },
    }).single(fieldName);
    uploader(req, res, next);
  };

/**
 * Express error-handling middleware for multer upload errors.
 * Translates multer-specific errors into user-friendly AppError responses,
 * including the configured size limit when a file exceeds the maximum.
 */
export const handleUploadError = (
  err: Error | multer.MulterError,
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const maxBytes = (req as Request & { _maxFileSizeBytes?: number })._maxFileSizeBytes;
      const limitMb = maxBytes ? Math.round(maxBytes / (1024 * 1024)) : null;
      const message = limitMb
        ? `File too large. Maximum upload size is ${limitMb} MB.`
        : 'File too large. Please check the configured upload size limit.';
      return next(new AppError(message, 413, ERROR_CODES.STORAGE_INVALID_PARAMETER));
    }

    const errorMap: Record<string, { status: number; message: string }> = {
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

/**
 * Extracts fields and files from a multipart form-data request
 * processed by multer and returns them as a structured object.
 */
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
