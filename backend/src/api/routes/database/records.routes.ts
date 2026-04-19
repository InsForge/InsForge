import { Router, Response, NextFunction } from 'express';
import axios from 'axios';
import { AuthRequest, extractApiKey, verifyUser } from '@/api/middlewares/auth.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { validateTableName } from '@/utils/validations.js';
import { DatabaseRecord } from '@/types/database.js';
import { successResponse } from '@/utils/response.js';
import { SocketManager } from '@/infra/socket/socket.manager.js';
import { DataUpdateResourceType, ServerEvents } from '@/types/socket.js';
import { DatabaseResourceUpdate } from '@/utils/sql-parser.js';
import { PostgrestProxyService } from '@/services/database/postgrest-proxy.service.js';
import { EncryptedColumnService } from '@/services/database/encrypted-column.service.js';

const router = Router();
const proxyService = PostgrestProxyService.getInstance();
const encryptedColumnService = EncryptedColumnService.getInstance();

/**
 * Helper to handle PostgREST proxy errors
 */
function handleProxyError(error: unknown, res: Response, next: NextFunction) {
  if (axios.isAxiosError(error) && error.response) {
    res.status(error.response.status).json(error.response.data);
  } else {
    next(error);
  }
}

/**
 * Forward database table requests to PostgREST
 */
const forwardToPostgrest = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { tableName, path: wildcardPath } = req.params;
  const path = wildcardPath ? `/${tableName}/${wildcardPath}` : `/${tableName}`;

  try {
    // Validate table name
    try {
      validateTableName(tableName);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('Invalid table name', 400, ERROR_CODES.INVALID_INPUT);
    }

    // Process request body for POST/PATCH/PUT (filter empty values based on column types)
    const method = req.method.toUpperCase();
    let body = req.body;

    // Look up encrypted columns for this table (cached, fast path returns empty map)
    const encryptedColumns = await encryptedColumnService.getEncryptedColumns(tableName);

    if (['POST', 'PATCH', 'PUT'].includes(method) && body && typeof body === 'object') {
      const columnTypeMap = await DatabaseManager.getColumnTypeMap(tableName);
      if (Array.isArray(body)) {
        body = body.map((item) => {
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
        for (const key in body) {
          if (columnTypeMap[key] === 'uuid' && body[key] === '') {
            delete body[key];
          }
        }
      }

      // Encrypt values for encrypted columns before forwarding to PostgREST
      if (encryptedColumns.size > 0) {
        if (Array.isArray(body)) {
          body = body.map((item) => {
            if (item && typeof item === 'object') {
              return encryptedColumnService.encryptRow(
                item as Record<string, unknown>,
                encryptedColumns
              );
            }
            return item;
          });
        } else {
          body = encryptedColumnService.encryptRow(
            body as Record<string, unknown>,
            encryptedColumns
          );
        }
      }
    }

    // Forward to PostgREST via service
    const result = await proxyService.forward({
      method: req.method,
      path,
      query: req.query as Record<string, unknown>,
      headers: req.headers as Record<string, string | string[] | undefined>,
      body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? body : undefined,
      apiKey: extractApiKey(req) ?? undefined,
    });

    // Forward response headers
    const headers = PostgrestProxyService.filterHeaders(result.headers);
    Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));

    // Handle empty responses
    let responseData = result.data;
    if (
      result.data === undefined ||
      (typeof result.data === 'string' && result.data.trim() === '')
    ) {
      responseData = [];
    }

    // Decrypt encrypted columns in response data
    if (encryptedColumns.size > 0 && responseData) {
      if (Array.isArray(responseData)) {
        responseData = responseData.map((row) => {
          if (row && typeof row === 'object') {
            return encryptedColumnService.decryptRow(
              row as Record<string, unknown>,
              encryptedColumns
            );
          }
          return row;
        });
      } else if (typeof responseData === 'object') {
        responseData = encryptedColumnService.decryptRow(
          responseData as Record<string, unknown>,
          encryptedColumns
        );
      }
    }

    // Broadcast socket events for mutations
    if (['POST', 'DELETE'].includes(method)) {
      const socket = SocketManager.getInstance();
      socket.broadcastToRoom(
        'role:project_admin',
        ServerEvents.DATA_UPDATE,
        {
          resource: DataUpdateResourceType.DATABASE,
          data: { changes: [{ type: 'records', name: tableName }] as DatabaseResourceUpdate[] },
        },
        'system'
      );
    }

    successResponse(res, responseData, result.status);
  } catch (error) {
    handleProxyError(error, res, next);
  }
};

// Forward all database operations to PostgREST (requires authentication)
router.all('/:tableName', verifyUser, forwardToPostgrest);
router.all('/:tableName/*path', verifyUser, forwardToPostgrest);

export { router as databaseRecordsRouter };
