import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { AppError } from '@/api/middlewares/error.js';
import {
  adminTableRecordUpdateQuerySchema,
  adminTableRecordUpdateRequestSchema,
  adminTableRecordLookupQuerySchema,
  adminTableRecordsCreateRequestSchema,
  adminTableRecordsDeleteQuerySchema,
  adminTableRecordsListQuerySchema,
  type AdminTableRecordsSortClause,
} from '@insforge/shared-schemas';
import { AdminRecordService } from '@/services/database/admin-record.service.js';
import {
  buildQualifiedTableKey,
  normalizeDatabaseSchemaName,
} from '@/services/database/helpers.js';
import { paginatedResponse, successResponse } from '@/utils/response.js';
import { ERROR_CODES } from '@/types/error-constants.js';
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

      const record = await recordsService.lookupRecord(
        schemaName,
        req.params.tableName,
        validation.data.column,
        validation.data.value
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
  '/tables/:tableName/records/:recordId',
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
        queryValidation.data.pkColumn,
        req.params.recordId,
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

      const pkValues = validation.data.pkValues
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

      if (pkValues.length === 0) {
        throw new AppError(
          'pkValues must include at least one primary key value.',
          400,
          ERROR_CODES.INVALID_INPUT,
          'Provide at least one non-empty primary key value.'
        );
      }

      const deletedCount = await recordsService.deleteRecords(
        schemaName,
        req.params.tableName,
        validation.data.pkColumn,
        pkValues
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
