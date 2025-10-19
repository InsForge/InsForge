import { Router, Response, NextFunction } from 'express';
import axios from 'axios';
import http from 'http';
import https from 'https';
import { upload } from '@/api/middleware/upload.js';
import { AuthRequest, extractApiKey } from '@/api/middleware/auth.js';
import { DatabaseManager } from '@/core/database/manager.js';
import { DatabaseTableService } from '@/core/database/table';
import { AppError } from '@/api/middleware/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { validateTableName } from '@/utils/validations.js';
import { parseAndValidateCSV, CSVValidationError } from '@/utils/import-csv.js';
import { preScanCSVForCandidates, logPreScanResults } from '@/utils/pre-scan-candidate.js';
import {
  fetchConstraintValuesFromDB,
  buildConstraintCheckers,
} from '@/utils/table-constraint-checker.js';
import { DatabaseRecord } from '@/types/database.js';
import { successResponse } from '@/utils/response.js';
import logger from '@/utils/logger.js';
import { SecretService } from '@/core/secrets/secrets.js';
import { AuthService } from '@/core/auth/auth.js';

const router = Router();
const authService = AuthService.getInstance();
const secretService = new SecretService();
const postgrestUrl = process.env.POSTGREST_BASE_URL || 'http://localhost:5430';

// Create a dedicated HTTP agent with connection pooling for PostgREST
// Optimized connection pool for Docker network communication
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 5000, // Shorter for Docker network
  maxSockets: 20, // Reduced for stability
  maxFreeSockets: 5,
  timeout: 10000, // Match axios timeout
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 5000,
  maxSockets: 20,
  maxFreeSockets: 5,
  timeout: 10000,
});

// Create axios instance with optimized configuration for PostgREST
const postgrestAxios = axios.create({
  httpAgent,
  httpsAgent,
  timeout: 10000, // Increased timeout for stability
  maxRedirects: 0,
  // Additional connection stability options
  headers: {
    Connection: 'keep-alive',
    'Keep-Alive': 'timeout=5, max=10',
  },
});

// Generate admin token once and reuse
// If user request with api key, this token should be added automatically.
const adminToken = authService.generateToken({
  sub: 'project-admin-with-api-key',
  email: 'project-admin@email.com',
  role: 'project_admin',
});
interface CSVImportMetadata {
  isCSVImport: boolean;
  successCount: number;
  failedCount: number;
  failedRows: CSVValidationError[];
  totalFailedRows: number;
}

// anonymous users can access the database, postgREST does not require authentication, however we seed to unwrap session token for better auth, thus
// we need to verify user token below.
// router.use(verifyUserOrApiKey);

/**
 * Forward database requests to PostgREST
 */
const forwardToPostgrest = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
  csvImportMetadata?: CSVImportMetadata
) => {
  const { tableName } = req.params;
  const wildcardPath = req.params[0] || '';

  // Build the target URL early so it's available in error handling
  const targetPath = wildcardPath ? `/${tableName}/${wildcardPath}` : `/${tableName}`;
  const targetUrl = `${postgrestUrl}${targetPath}`;

  try {
    // Validate table name with operation type
    const method = req.method.toUpperCase();

    try {
      validateTableName(tableName);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('Invalid table name', 400, ERROR_CODES.INVALID_INPUT);
    }

    // Process request body for POST/PATCH/PUT operations
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

    // Check for API key using shared logic
    const apiKey = extractApiKey(req);

    // If we have an API key, verify it and use admin token for PostgREST
    if (apiKey) {
      const isValid = await secretService.verifyApiKey(apiKey);
      if (isValid) {
        axiosConfig.headers.authorization = `Bearer ${adminToken}`;
      }
    }

    // Add body for methods that support it
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      axiosConfig.data = req.body;
    }

    // Enhanced retry logic with improved error handling
    let response;
    let lastError;
    const maxRetries = 3; // Increased retries for connection resets

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        response = await postgrestAxios(axiosConfig);
        break; // Success, exit retry loop
      } catch (error) {
        lastError = error;

        // Retry on network errors (ECONNRESET, ECONNREFUSED, timeout) but not HTTP errors
        const shouldRetry = axios.isAxiosError(error) && !error.response && attempt < maxRetries;

        if (shouldRetry) {
          logger.warn(`PostgREST request failed, retrying (attempt ${attempt}/${maxRetries})`, {
            url: targetUrl,
            errorCode: error.code,
            message: error.message,
          });

          // Enhanced exponential backoff: 200ms, 500ms, 1000ms
          const backoffDelay = Math.min(200 * Math.pow(2.5, attempt - 1), 1000);
          await new Promise((resolve) => setTimeout(resolve, backoffDelay));
        } else {
          throw error; // Don't retry on HTTP errors or last attempt
        }
      }
    }

    if (!response) {
      throw lastError || new Error('Failed to get response from PostgREST');
    }

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

    const csvMetadata = csvImportMetadata;
    if (csvMetadata?.isCSVImport) {
      logger.info('CSV import completed successfully', {
        table: req.params.tableName,
        recordsImported: csvMetadata.successCount,
      });

      return res.status(200).json({
        success: true,
        message: `Successfully imported ${csvMetadata.successCount} record${csvMetadata.successCount !== 1 ? 's' : ''}`,
        csvImport: {
          successCount: csvMetadata.successCount,
          failedCount: 0,
          failedRows: [],
          totalFailedRows: 0,
        },
      });
    } else {
      successResponse(res, responseData, response.status);
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      // Log more detailed error information
      logger.error('PostgREST request failed', {
        url: targetUrl,
        method: req.method,
        error: {
          code: error.code,
          message: error.message,
          response: error.response?.data,
          responseStatus: error.response?.status,
        },
      });

      // Forward PostgREST errors
      if (error.response) {
        res.status(error.response.status).json(error.response.data);
      } else {
        // Network error - connection refused, DNS failure, etc.
        const errorMessage =
          error.code === 'ECONNREFUSED'
            ? 'PostgREST connection refused'
            : error.code === 'ENOTFOUND'
              ? 'PostgREST service not found'
              : 'Database service unavailable';

        next(new AppError(errorMessage, 503, ERROR_CODES.INTERNAL_ERROR));
      }
    } else {
      logger.error('Unexpected error in database route', { error });
      next(error);
    }
  }
};

router.post(
  '/import/:tableName',
  upload.single('file'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { tableName } = req.params;

      if (!req.file) {
        throw new AppError(
          'No file provided',
          400,
          ERROR_CODES.INVALID_INPUT,
          'Please upload a CSV file'
        );
      }

      if (req.file.mimetype !== 'text/csv' && !req.file.originalname.endsWith('.csv')) {
        throw new AppError(
          'Invalid file type',
          400,
          ERROR_CODES.INVALID_INPUT,
          'Please upload a valid CSV file'
        );
      }

      try {
        validateTableName(tableName);
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        throw new AppError('Invalid table name', 400, ERROR_CODES.INVALID_INPUT);
      }

      const tableService = new DatabaseTableService();
      const tableSchema = await tableService.getTableSchema(tableName);
      if (!tableSchema || tableSchema.columns.length === 0) {
        throw new AppError(
          'Table not found',
          404,
          ERROR_CODES.DATABASE_NOT_FOUND,
          `Table ${tableName} does not exist or has no columns`
        );
      }

      logger.info('Starting CSV import', {
        tableName,
        fileName: req.file.originalname,
        fileSize: req.file.size,
      });

      // Pre-scan CSV to collect candidate values
      let preScanResult;
      try {
        logger.info('Pre-scanning CSV for candidate values');
        preScanResult = await preScanCSVForCandidates(req.file.buffer, tableSchema.columns);
        logPreScanResults(tableName, preScanResult);
      } catch (prescanError) {
        logger.error('CSV pre-scan failed', { error: prescanError });
        throw new AppError(
          'Failed to pre-scan CSV file',
          400,
          ERROR_CODES.INVALID_INPUT,
          prescanError instanceof Error ? prescanError.message : 'Unknown error'
        );
      }

      // Batch query database for existing constraint values
      let existingDbValues: Record<string, Set<string>> = {};
      try {
        logger.info('Starting batch database queries for constraint validation');
        existingDbValues = await fetchConstraintValuesFromDB(
          postgrestAxios,
          postgrestUrl,
          adminToken,
          tableName,
          tableSchema.columns,
          preScanResult.candidateValues
        );
      } catch (dbQueryError) {
        logger.error('Database batch query failed', { error: dbQueryError });
        throw new AppError(
          'Failed to validate constraints',
          500,
          ERROR_CODES.INTERNAL_ERROR,
          dbQueryError instanceof Error ? dbQueryError.message : 'Unknown error'
        );
      }

      // Build constraint checkers using pre-fetched values
      const constraintCheckers = buildConstraintCheckers(existingDbValues);

      logger.info('Parsing and validating CSV with constraint checks');

      // Parse and validate CSV with constraint information
      const parseResult = await parseAndValidateCSV(req.file.buffer, tableSchema.columns, {
        tableName,
        checkUnique: constraintCheckers.checkUnique,
        checkForeignKey: constraintCheckers.checkForeignKey,
      });

      // Check for header validation errors
      if (parseResult.validationErrors.length > 0) {
        logger.warn('CSV header validation failed', {
          tableName,
          errors: parseResult.validationErrors,
        });

        return res.status(400).json({
          success: false,
          message: 'CSV header validation failed. Please check the column names in your file.',
          errors: parseResult.validationErrors,
          rowErrors: [],
          totalRowErrors: 0,
        });
      }

      // Check if there are ANY row errors - reject import if any exist
      if (parseResult.rowErrors.length > 0) {
        logger.warn('CSV validation failed with row errors', {
          tableName,
          failedRowCount: parseResult.rowErrors.length,
          validRowCount: parseResult.rows.length,
        });

        return res.status(400).json({
          success: false,
          message: `Import failed: ${parseResult.rowErrors.length} row${parseResult.rowErrors.length !== 1 ? 's have' : ' has'} validation errors. Please fix all errors and try again.`,
          rowErrors: parseResult.rowErrors.slice(0, 20),
          totalRowErrors: parseResult.rowErrors.length,
          validRowCount: parseResult.rows.length,
        });
      }

      // All rows are valid - proceed with import
      if (parseResult.rows.length === 0) {
        logger.warn('No valid rows in CSV after validation', { tableName });

        return res.status(400).json({
          success: false,
          message: 'No valid rows found in CSV file',
          rowErrors: [],
          totalRowErrors: 0,
        });
      }

      logger.info('CSV validation passed, proceeding with import', {
        tableName,
        validRowCount: parseResult.rows.length,
      });

      // Inject parsed rows into request body
      req.body = parseResult.rows;
      req.method = 'POST';
      req.params[0] = '';

      delete req.file;
      delete (req.headers as Record<string, unknown>)['content-type'];
      delete (req.headers as Record<string, unknown>)['content-length'];
      delete (req.headers as Record<string, unknown>)['transfer-encoding'];

      // Attach CSV metadata for response handling
      const csvMetadata: CSVImportMetadata = {
        isCSVImport: true,
        successCount: parseResult.rows.length,
        failedCount: 0,
        failedRows: [],
        totalFailedRows: 0,
      };

      // Forward to PostgREST for actual insertion
      return forwardToPostgrest(req, res, next, csvMetadata);
    } catch (error) {
      logger.error('CSV import preprocessing failed', {
        tableName: req.params.tableName,
        error,
      });
      next(error);
    }
  }
);

router.get(
  '/_meta/sample/:tableName',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { tableName } = req.params;

      // Validate table name
      try {
        validateTableName(tableName);
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        throw new AppError('Invalid table name', 400, ERROR_CODES.INVALID_INPUT);
      }

      // Retrieve table schema
      let tableSchema;
      const tableService = new DatabaseTableService();
      try {
        tableSchema = await tableService.getTableSchema(tableName);
      } catch (error) {
        logger.error('Failed to retrieve table schema for sample CSV', {
          tableName,
          error,
        });
        throw new AppError(
          'Table not found',
          404,
          ERROR_CODES.DATABASE_NOT_FOUND,
          `Table "${tableName}" does not exist`
        );
      }

      if (!tableSchema || tableSchema.columns.length === 0) {
        throw new AppError(
          'Table has no columns',
          400,
          ERROR_CODES.INVALID_INPUT,
          `Table "${tableName}" exists but has no columns defined`
        );
      }
      const systemColumns = new Set(['id', 'created_at', 'updated_at']);
      const userColumns = tableSchema.columns.filter((col) => !systemColumns.has(col.columnName));

      if (userColumns.length === 0) {
        throw new AppError(
          'No user-defined columns',
          400,
          ERROR_CODES.INVALID_INPUT,
          `Table "${tableName}" has no user-defined columns (only system columns)`
        );
      }

      // Build CSV header from filtered columns
      const headers = userColumns
        .map((col) => {
          // Escape column names with special characters
          if (col.columnName.includes(',') || col.columnName.includes('"')) {
            return `"${col.columnName.replace(/"/g, '""')}"`;
          }
          return col.columnName;
        })
        .join(',');

      const csvContent = `${headers}\n`;

      // Set headers for file download
      const fileName = `${tableName}_sample.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

      logger.info('Sample CSV generated', {
        tableName,
        columnCount: tableSchema.columns.length,
        fileName,
      });

      res.send(csvContent);
    } catch (error) {
      logger.error('Failed to generate sample CSV', {
        tableName: req.params.tableName,
        error,
      });
      next(error);
    }
  }
);

// Forward all database operations to PostgREST
router.all('/:tableName', (req: AuthRequest, res: Response, next: NextFunction) =>
  forwardToPostgrest(req, res, next)
);
router.all('/:tableName/*', (req: AuthRequest, res: Response, next: NextFunction) =>
  forwardToPostgrest(req, res, next)
);

export { router as databaseRecordsRouter };
