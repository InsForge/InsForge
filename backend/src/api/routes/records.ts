import { Router, Response, NextFunction } from 'express';
import axios from 'axios';
import { AuthRequest } from '@/api/middleware/auth.js';
import { DatabaseManager } from '@/core/database/database.js';
import { AppError } from '@/api/middleware/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { validateTableName } from '@/utils/validations.js';
import { DatabaseRecord } from '@/types/database.js';
import { successResponse } from '@/utils/response.js';
import { AuthService } from '@/core/auth/auth.js';

const router = Router();
const dbManager = DatabaseManager.getInstance();
const authService = AuthService.getInstance();
const postgrestUrl = process.env.POSTGREST_BASE_URL || 'http://localhost:5430';

// Generate admin token once and reuse
// If user request with api key, this token should be added automatically.
const adminToken = authService.generateToken({
  sub: 'project-admin-with-api-key',
  email: 'project-admin@email.com',
  role: 'project_admin',
  type: 'admin',
});

// anonymous users can access the database, postgREST does not require authentication
// router.use(verifyUserOrApiKey);

/**
 * Forward database requests to PostgREST
 */
const forwardToPostgrest = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tableName } = req.params;
    const wildcardPath = req.params[0] || '';

    // Validate table name (includes check for system tables)
    try {
      validateTableName(tableName);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('Invalid table name', 400, ERROR_CODES.INVALID_INPUT);
    }

    // Process request body for POST/PATCH/PUT operations
    const method = req.method.toUpperCase();
    if (['POST', 'PATCH', 'PUT'].includes(method) && req.body && typeof req.body === 'object') {
      const columnTypeMap = await DatabaseManager.getColumnTypeMap(tableName);
      if (Array.isArray(req.body)) {
        req.body = req.body.map((item) => {
          if (item && typeof item === 'object') {
            const filtered: DatabaseRecord = {};
            for (const key in item) {
              if (columnTypeMap[key] !== 'text' && item[key] === '') {
                continue;
              }
              filtered[key] = item[key];
            }
            return filtered;
          }
          return item;
        });
      } else {
        const body = req.body as DatabaseRecord;
        for (const key in body) {
          if (columnTypeMap[key] === 'uuid' && body[key] === '') {
            delete body[key];
          }
        }
      }
    }

    // Build the target URL
    const targetPath = wildcardPath ? `/${tableName}/${wildcardPath}` : `/${tableName}`;
    const targetUrl = `${postgrestUrl}${targetPath}`;

    // Forward the request
    const axiosConfig: {
      method: string;
      url: string;
      params: unknown;
      headers: Record<string, string | string[] | undefined>;
      data?: unknown;
    } = {
      method: req.method,
      url: targetUrl,
      params: req.query,
      headers: {
        ...req.headers,
        host: undefined, // Remove host header
        'content-length': undefined, // Let axios calculate
      },
    };

    // If no authorization header, check api key
    if (!req.headers.authorization) {
      const apiKey = req.headers['x-api-key'] as string;
      if (apiKey) {
        // If API key is provided, use it
        const isValid = await authService.verifyApiKey(apiKey);
        if (isValid) {
          axiosConfig.headers.authorization = `Bearer ${adminToken}`;
        }
      }
    }

    // Add body for methods that support it
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      axiosConfig.data = req.body;
    }

    // Make the request to PostgREST
    const response = await axios(axiosConfig);

    // Forward response headers
    Object.entries(response.headers).forEach(([key, value]) => {
      const keyLower = key.toLowerCase();
      if (
        keyLower !== 'content-length' &&
        keyLower !== 'transfer-encoding' &&
        keyLower !== 'connection' &&
        keyLower !== 'content-encoding'
      ) {
        res.setHeader(key, value);
      }
    });

    // Handle empty responses
    let responseData = response.data;
    if (
      response.data === undefined ||
      (typeof response.data === 'string' && response.data.trim() === '')
    ) {
      responseData = [];
    }

    // Set status and send response
    successResponse(res, responseData, response.status);

    // Log the activity
    await dbManager.logActivity(req.method, tableName, wildcardPath || 'table', {
      query: req.query,
      user_id: req.user?.id,
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      // Forward PostgREST errors
      if (error.response) {
        res.status(error.response.status).json(error.response.data);
      } else {
        next(new AppError('Database service unavailable', 503, ERROR_CODES.INTERNAL_ERROR));
      }
    } else {
      next(error);
    }
  }
};

// Forward all database operations to PostgREST
router.all('/:tableName', forwardToPostgrest);
router.all('/:tableName/*', forwardToPostgrest);

export { router as databaseRouter };
