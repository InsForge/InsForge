import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { AppError } from '@/utils/errors.js';
import {
  ERROR_CODES,
  adminTableRecordPrimaryKeySchema,
  adminTableRecordUpdateQuerySchema,
  adminTableRecordUpdateRequestSchema,
  adminTableRecordLookupQuerySchema,
  adminTableRecordsCreateRequestSchema,
  adminTableRecordsDeleteQuerySchema,
  adminTableRecordsListQuerySchema,
  type AdminTableRecordPrimaryKey,
  type AdminTableRecordsSortClause,
} from '@insforge/shared-schemas';
import { AdminRecordService } from '@/services/database/admin-record.service.js';
import {
  buildQualifiedTableKey,
  normalizeDatabaseSchemaName,
} from '@/services/database/helpers.js';
import { paginatedResponse, successResponse } from '@/utils/response.js';
import { SocketManager } from '@/infra/socket/socket.manager.js';
import { DataUpdateResourceType, ServerEvents } from '@/types/socket.js';
import type { DatabaseResourceUpdate } from '@/utils/sql-parser.js';
import type { DatabaseRecord } from '@/types/database.js';

function getValidationMessage(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
}

function parseSort(sort: string | undefined): AdminTableRecordsSortClause[] {
  if (!sort) {
    return [];
  }

  return sort
    .split(',')
    .map((clause) => clause.trim())
    .filter(Boolean)
    .map((clause) => {
      const [columnName, direction = 'asc', ...rest] = clause.split(':');

      if (!columnName || rest.length > 0) {
        throw new AppError(
          `Invalid sort clause "${clause}".`,
          400,
          ERROR_CODES.INVALID_INPUT,
          'Use sort values like "created_at:desc,name:asc".'
        );
      }

      const normalizedDirection = direction.toLowerCase();
      if (normalizedDirection !== 'asc' && normalizedDirection !== 'desc') {
        throw new AppError(
          `Invalid sort direction "${direction}".`,
          400,
          ERROR_CODES.INVALID_INPUT,
          'Use either "asc" or "desc" for sort direction.'
        );
      }

      return {
        columnName,
        direction: normalizedDirection as AdminTableRecordsSortClause['direction'],
      };
    });
}

function parseJsonQueryParam(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError(
      'Invalid pkKeys parameter.',
      400,
      ERROR_CODES.INVALID_INPUT,
      'pkKeys must be a JSON-encoded primary key.'
    );
  }
}

// Parses the `pkKeys` query param for an update: a single JSON object mapping each
// primary-key column to its value.
function parsePrimaryKey(raw: string): AdminTableRecordPrimaryKey {
  const validation = adminTableRecordPrimaryKeySchema.safeParse(parseJsonQueryParam(raw));
  if (!validation.success) {
    throw new AppError(getValidationMessage(validation.error), 400, ERROR_CODES.INVALID_INPUT);
  }
  return validation.data;
}

// Parses the `pkKeys` query param for a delete: a JSON array of primary-key objects.
function parsePrimaryKeys(raw: string): AdminTableRecordPrimaryKey[] {
  const validation = z
    .array(adminTableRecordPrimaryKeySchema)
    .min(1, 'At least one primary key is required.')
    .safeParse(parseJsonQueryParam(raw));
  if (!validation.success) {
    throw new AppError(getValidationMessage(validation.error), 400, ERROR_CODES.INVALID_INPUT);
  }
  return validation.data;
}

function broadcastRecordChange(schemaName: string, tableName: string): void {
  const socket = SocketManager.getInstance();
  socket.broadcastToRoom(
    'role:project_admin',
    ServerEvents.DATA_UPDATE,
    {
      resource: DataUpdateResourceType.DATABASE,
      data: {
        changes: [
          { type: 'records', name: buildQualifiedTableKey(tableName, schemaName) },
        ] as DatabaseResourceUpdate[],
      },
    },
    'system'
  );
}

const router = Router();
const recordsService = AdminRecordService.getInstance();

router.use(verifyAdmin);

router.get(
  '/tables/:tableName/records',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const schemaName = normalizeDatabaseSchemaName(req.query.schema);
      const validation = adminTableRecordsListQuerySchema.safeParse(req.query);
      if (!validation.success) {
        throw new AppError(getValidationMessage(validation.error), 400, ERROR_CODES.INVALID_INPUT);
      }

      const { limit, offset, search, sort, filterColumn, filterValue } = validation.data;
      const response = await recordsService.listRecords(schemaName, req.params.tableName, {
        limit,
        offset,
        search,
        sort: parseSort(sort),
        filterColumn,
        filterValue,
      });

      paginatedResponse(res, response.records, response.total, offset);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/tables/:tableName/records/lookup',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const schemaName = normalizeDatabaseSchemaName(req.query.schema);
      const validation = adminTableRecordLookupQuerySchema.safeParse(req.query);
      if (!validation.success) {
        throw new AppError(getValidationMessage(validation.error), 400, ERROR_CODES.INVALID_INPUT);
      }

      const { column, value } = validation.data;
      const columns = Array.isArray(column) ? column : [column];
      const values = Array.isArray(value) ? value : [value];

      const record = await recordsService.lookupRecord(
        schemaName,
        req.params.tableName,
        columns,
        values
      );

      successResponse(res, record);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/tables/:tableName/records',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const schemaName = normalizeDatabaseSchemaName(req.query.schema);
      const validation = adminTableRecordsCreateRequestSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(getValidationMessage(validation.error), 400, ERROR_CODES.INVALID_INPUT);
      }

      const createdRecords = await recordsService.createRecords(
        schemaName,
        req.params.tableName,
        validation.data as DatabaseRecord[]
      );

      broadcastRecordChange(schemaName, req.params.tableName);
      successResponse(res, createdRecords, 201);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  '/tables/:tableName/records',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const schemaName = normalizeDatabaseSchemaName(req.query.schema);
      const queryValidation = adminTableRecordUpdateQuerySchema.safeParse(req.query);
      if (!queryValidation.success) {
        throw new AppError(
          getValidationMessage(queryValidation.error),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const primaryKey = parsePrimaryKey(queryValidation.data.pkKeys);

      const bodyValidation = adminTableRecordUpdateRequestSchema.safeParse(req.body);
      if (!bodyValidation.success) {
        throw new AppError(
          getValidationMessage(bodyValidation.error),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const updatedRecord = await recordsService.updateRecord(
        schemaName,
        req.params.tableName,
        primaryKey,
        bodyValidation.data as DatabaseRecord
      );

      broadcastRecordChange(schemaName, req.params.tableName);
      successResponse(res, updatedRecord);
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  '/tables/:tableName/records',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const schemaName = normalizeDatabaseSchemaName(req.query.schema);
      const validation = adminTableRecordsDeleteQuerySchema.safeParse(req.query);
      if (!validation.success) {
        throw new AppError(getValidationMessage(validation.error), 400, ERROR_CODES.INVALID_INPUT);
      }

      const primaryKeys = parsePrimaryKeys(validation.data.pkKeys);

      const deletedCount = await recordsService.deleteRecords(
        schemaName,
        req.params.tableName,
        primaryKeys
      );

      if (deletedCount > 0) {
        broadcastRecordChange(schemaName, req.params.tableName);
      }

      successResponse(res, { deletedCount });
    } catch (error) {
      next(error);
    }
  }
);

export { router as databaseAdminRouter };
