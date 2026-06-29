import { Router, Response, NextFunction } from 'express';
import axios from 'axios';
import { AuthRequest, verifyUser } from '@/api/middlewares/auth.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { validateTableName } from '@/utils/validations.js';
import { DatabaseRecord } from '@/types/database.js';
import { TEXT_LIKE_DATA_TYPES } from '@/utils/constants.js';
import { successResponse } from '@/utils/response.js';
import { SocketManager } from '@/infra/socket/socket.manager.js';
import { DataUpdateResourceType, ServerEvents } from '@/types/socket.js';
import { DatabaseResourceUpdate } from '@/utils/sql-parser.js';
import { PostgrestProxyService } from '@/services/database/postgrest-proxy.service.js';
import { resolvePostgrestSchema } from '@/services/database/helpers.js';

const router = Router();
const proxyService = PostgrestProxyService.getInstance();

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

    // Resolve the target schema the native PostgREST way: an explicit ?schema=
    // is desugared into the Accept-Profile/Content-Profile header (and stripped
    // from the forwarded query); a client-sent profile header is honored as-is.
    const {
      schemaName,
      query: forwardedQuery,
      headers: forwardedHeaders,
    } = resolvePostgrestSchema(
      req.method,
      req.query as Record<string, unknown>,
      req.headers as Record<string, string | string[] | undefined>
    );

    // Process request body for POST/PATCH/PUT (filter empty values based on column types)
    const method = req.method.toUpperCase();
    let body = req.body;

    if (['POST', 'PATCH', 'PUT'].includes(method) && body && typeof body === 'object') {
      const columnTypeMap = await DatabaseManager.getColumnTypeMap(tableName, schemaName);
      if (Array.isArray(body)) {
        body = body.map((item) => {
          if (item && typeof item === 'object') {
            const filtered: DatabaseRecord = {};
            for (const key in item) {
              if (!TEXT_LIKE_DATA_TYPES.has(columnTypeMap[key] ?? '') && item[key] === '') {
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
          if (!TEXT_LIKE_DATA_TYPES.has(columnTypeMap[key] ?? '') && body[key] === '') {
            delete body[key];
          }
        }
      }
    }

    // Forward to PostgREST via service
    const proxyRequest = {
      method: req.method,
      path,
      query: forwardedQuery,
      headers: forwardedHeaders,
      body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? body : undefined,
    };

    const result =
      req.user?.role === 'project_admin' || req.hasApiKey === true
        ? await proxyService.forwardAsAdmin(proxyRequest)
        : req.user
          ? await proxyService.forwardAsUser(proxyRequest, req.user)
          : await proxyService.forwardAsAnon(proxyRequest);

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
