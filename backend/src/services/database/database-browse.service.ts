import { Pool } from 'pg';
import {
  ColumnSchema,
  ColumnType,
  guardedValueDisplayText,
  guardedValueFlag,
} from '@insforge/shared-schemas';
import { AppError } from '@/api/middlewares/error.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { config } from '@/infra/config/app.config.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { DatabaseTableService } from './database-table.service.js';
import { escapeSqlLikePattern, validateIdentifier } from '@/utils/validations.js';

type BrowseQuery = {
  limit?: number;
  offset?: number;
  order?: string;
  search?: string;
};

type BrowseResult = {
  rows: Record<string, unknown>[];
  total: number;
};

const TEXT_COLUMN_TYPES = new Set(['text', 'character varying', 'character']);
const JSON_COLUMN_TYPES = new Set(['json', 'jsonb']);
const BINARY_COLUMN_TYPES = new Set(['bytea']);

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

export class DatabaseBrowseService {
  private static instance: DatabaseBrowseService;
  private pool: Pool | null = null;
  private tableService = DatabaseTableService.getInstance();

  private constructor() {}

  static getInstance() {
    if (!DatabaseBrowseService.instance) {
      DatabaseBrowseService.instance = new DatabaseBrowseService();
    }
    return DatabaseBrowseService.instance;
  }

  private getPool() {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  private buildGuardExpression(columnName: string, sqlType: string) {
    const safeColumnName = quoteIdentifier(columnName);
    const normalizedType = sqlType.toLowerCase();

    if (TEXT_COLUMN_TYPES.has(normalizedType)) {
      return `octet_length(t.${safeColumnName})`;
    }

    if (JSON_COLUMN_TYPES.has(normalizedType)) {
      return `octet_length(t.${safeColumnName}::text)`;
    }

    if (BINARY_COLUMN_TYPES.has(normalizedType)) {
      return `octet_length(t.${safeColumnName})`;
    }

    return `octet_length(to_jsonb(t.${safeColumnName})::text)`;
  }

  private buildColumnPairs(columns: ColumnSchema[], columnTypeMap: Record<string, string>) {
    return columns
      .map((column) => {
        const columnName = column.columnName;
        const sqlType = columnTypeMap[columnName] ?? String(column.type);
        const guardExpression = this.buildGuardExpression(columnName, sqlType);

        return `${quoteLiteral(columnName)}, CASE
          WHEN ${guardExpression} > ${config.database.recordBrowseCellMaxBytes}
            THEN jsonb_build_object(${quoteLiteral(guardedValueFlag)}, true, 'message', ${quoteLiteral(guardedValueDisplayText)})
          ELSE to_jsonb(t.${quoteIdentifier(columnName)})
        END`;
      })
      .join(', ');
  }

  private parseOrderClause(order: string | undefined, allowedColumns: Set<string>) {
    if (!order) {
      if (allowedColumns.has('created_at')) {
        return ' ORDER BY t."created_at" DESC';
      }
      if (allowedColumns.has('id')) {
        return ' ORDER BY t."id" DESC';
      }
      return '';
    }

    const clauses = order
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [columnName, direction = 'asc'] = part.split('.');
        validateIdentifier(columnName, 'column');

        if (!allowedColumns.has(columnName)) {
          throw new AppError(
            `Invalid sort column: ${columnName}`,
            400,
            ERROR_CODES.INVALID_INPUT,
            'Please sort using a valid column from the selected table.'
          );
        }

        const normalizedDirection = direction.toLowerCase();
        if (normalizedDirection !== 'asc' && normalizedDirection !== 'desc') {
          throw new AppError(
            `Invalid sort direction: ${direction}`,
            400,
            ERROR_CODES.INVALID_INPUT,
            'Sort direction must be either asc or desc.'
          );
        }

        return `t.${quoteIdentifier(columnName)} ${normalizedDirection.toUpperCase()}`;
      });

    return clauses.length ? ` ORDER BY ${clauses.join(', ')}` : '';
  }

  async browseTable(tableName: string, query: BrowseQuery): Promise<BrowseResult> {
    validateIdentifier(tableName, 'table');

    const schema = await this.tableService.getTableSchema(tableName);
    const allowedColumns = new Set(schema.columns.map((column) => column.columnName));
    const columnTypeMap = await DatabaseManager.getColumnTypeMap(tableName);
    const limit = clamp(query.limit ?? 10, 1, config.database.recordBrowseMaxRows);
    const offset = Math.max(query.offset ?? 0, 0);
    const orderClause = this.parseOrderClause(query.order, allowedColumns);
    const search = query.search?.trim();
    const searchableColumns = schema.columns.filter((column) => column.type === ColumnType.STRING);
    const hasSearchFilter = Boolean(search && searchableColumns.length);
    const whereClause = hasSearchFilter
      ? ` WHERE ${searchableColumns.map((column) => `t.${quoteIdentifier(column.columnName)}::text ILIKE $1 ESCAPE '\\'`).join(' OR ')}`
      : '';
    const params = hasSearchFilter ? [`%${escapeSqlLikePattern(search ?? '')}%`] : [];
    const columnPairs = this.buildColumnPairs(schema.columns, columnTypeMap);
    const pool = this.getPool();
    const countQuery = `SELECT COUNT(*)::int AS total FROM ${quoteIdentifier(tableName)} t${whereClause}`;
    const dataQuery = `
      SELECT jsonb_build_object(${columnPairs}) AS row_data
      FROM ${quoteIdentifier(tableName)} t
      ${whereClause}
      ${orderClause}
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const [countResult, dataResult] = await Promise.all([
      pool.query<{ total: number }>(countQuery, params),
      pool.query<{ row_data: Record<string, unknown> }>(dataQuery, params),
    ]);

    return {
      rows: dataResult.rows.map((row) => row.row_data),
      total: countResult.rows[0]?.total ?? 0,
    };
  }
}
