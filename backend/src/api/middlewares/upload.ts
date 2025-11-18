import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { ProcessedFormData } from '@/types/storage.js';

// Constants
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_MAX_FILES = 10;

// Create multer instance with memory storage
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
  _req: Request,
  _res: Response,
  next: NextFunction
) => {
  if (err instanceof multer.MulterError) {
    const errorMap: Record<string, { status: number; message: string }> = {
      LIMIT_FILE_SIZE: { status: 413, message: 'File too large' },
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
