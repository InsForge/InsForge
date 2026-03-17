import { Router, Response, NextFunction } from 'express';
import axios from 'axios';
import { AuthRequest, extractApiKey } from '@/api/middlewares/auth.js';
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
import { config } from '@/infra/config/app.config.js';

const BROWSE_QUERY_KEYS = new Set(['limit', 'offset', 'order', 'or']);

/** Detect if this is a dashboard browse request (paginated GET with only browse params) */
export function isBrowseRequest(
  method: string,
  query: Record<string, unknown>,
  hasWildcardPath: boolean
): boolean {
  if (method !== 'GET' || hasWildcardPath) {
    return false;
  }
  if (query.limit === undefined || query.offset === undefined) {
    return false;
  }
  // Only intercept if all query keys are browse-specific (no select, filters, embeds)
  return Object.keys(query).every((key) => BROWSE_QUERY_KEYS.has(key));
}

/** Extract search term from PostgREST `or` filter format: (col.ilike.*term*,col2.ilike.*term*) */
export function extractSearchTerm(orFilter: string | undefined): string | null {
  if (!orFilter || !orFilter.trim()) {
    return null;
  }
  const match = orFilter.match(/\.ilike\.\*([^*]+)\*/);
  return match ? match[1] : null;
}

/** Parse PostgREST order param (e.g., "created_at.desc") into column + direction */
export function parseOrderParam(
  order: string | undefined
): { column: string; direction: string } | null {
  if (!order || !order.trim()) {
    return null;
  }
  const parts = order.split('.');
  return {
    column: parts[0],
    direction: parts[1]?.toLowerCase() === 'desc' ? 'desc' : 'asc',
  };
}

/** Parse a string to a positive integer, returning the fallback if invalid */
function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

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

    const method = req.method.toUpperCase();
    const query = req.query as Record<string, unknown>;

    // Route browse requests (paginated GETs) to guarded RPC
    if (isBrowseRequest(method, query, !!wildcardPath)) {
      const limit = parsePositiveInt(query.limit, 50);
      const offset = parsePositiveInt(query.offset, 0);
      const order = parseOrderParam(query.order ? String(query.order) : undefined);
      const searchTerm = extractSearchTerm(query.or ? String(query.or) : undefined);

      const pool = DatabaseManager.getInstance().getPool();
      const result = await pool.query(
        'SELECT system.browse_records_guarded($1, $2, $3, $4, $5, $6, $7)',
        [
          tableName,
          limit,
          offset,
          order?.column || null,
          order?.direction || 'asc',
          searchTerm,
          config.database.recordBrowseCellMaxBytes,
        ]
      );

      const raw = result.rows[0]?.browse_records_guarded;
      const rpcResult =
        typeof raw === 'string' ? JSON.parse(raw) : (raw ?? { rows: [], total: 0 });

      const total: number = rpcResult.total || 0;
      if (total === 0 || limit === 0) {
        res.setHeader('content-range', `*/${total}`);
      } else {
        const endRange = Math.min(offset + limit - 1, total - 1);
        res.setHeader('content-range', `${offset}-${endRange}/${total}`);
      }

      return successResponse(res, rpcResult.rows, 200);
    }

    // Process request body for POST/PATCH/PUT (filter empty values based on column types)
    let body = req.body;

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

// Forward all database operations to PostgREST
router.all('/:tableName', forwardToPostgrest);
router.all('/:tableName/*path', forwardToPostgrest);

export { router as databaseRecordsRouter };
