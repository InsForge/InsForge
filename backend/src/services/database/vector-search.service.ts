import { AppError } from '@/api/middlewares/error.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import {
  assertWritableDatabaseSchema,
  DEFAULT_DATABASE_SCHEMA,
  normalizeDatabaseSchemaName,
  quoteIdentifier,
  quoteQualifiedName,
  splitQualifiedTableReference,
} from '@/services/database/helpers.js';
import { UserContext, withUserContext } from '@/services/db/user-context.service.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import type {
  VectorSearchMetric,
  VectorSearchRequest,
  VectorSearchResponse,
} from '@insforge/shared-schemas';
import type { PoolClient } from 'pg';

const VECTOR_OPERATORS: Record<VectorSearchMetric, '<=>' | '<->' | '<#>'> = {
  cosine: '<=>',
  l2: '<->',
  inner_product: '<#>',
};

interface ResolvedVectorTarget {
  schemaName: string;
  tableName: string;
  columnName: string;
}

interface VectorSearchRow {
  row: Record<string, unknown>;
  distance: number | string;
}

export class VectorSearchService {
  private static instance: VectorSearchService;
  private dbManager = DatabaseManager.getInstance();

  private constructor() {}

  public static getInstance(): VectorSearchService {
    if (!VectorSearchService.instance) {
      VectorSearchService.instance = new VectorSearchService();
    }
    return VectorSearchService.instance;
  }

  async search(input: VectorSearchRequest, ctx: UserContext): Promise<VectorSearchResponse> {
    const target = resolveVectorTarget(input);
    const pool = this.dbManager.getPool();

    return withUserContext(pool, ctx, async (client) => {
      await client.query('SET statement_timeout = 30000');
      try {
        await this.assertVectorColumn(client, target, input.query_vector.length);
        return this.executeVectorSearch(client, input, target);
      } finally {
        await client.query('SET statement_timeout = 0').catch(() => {});
      }
    });
  }

  private async assertVectorColumn(
    client: PoolClient,
    target: ResolvedVectorTarget,
    queryVectorDimensions: number
  ): Promise<void> {
    const result = await client.query<{ dataType: string }>(
      `
        SELECT format_type(a.atttypid, a.atttypmod) AS "dataType"
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1
          AND c.relname = $2
          AND a.attname = $3
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND c.relkind IN ('r', 'p', 'v', 'm')
      `,
      [target.schemaName, target.tableName, target.columnName]
    );

    if (result.rows.length === 0) {
      throw new AppError(
        `Vector column "${target.columnName}" was not found on ${target.schemaName}.${target.tableName}`,
        404,
        ERROR_CODES.NOT_FOUND
      );
    }

    const dataType = result.rows[0].dataType;
    if (!/^vector(?:\(\d+\))?$/.test(dataType)) {
      throw new AppError(
        `Column "${target.columnName}" must use the pgvector vector type, found ${dataType}`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const constrainedDimensions = /^vector\((\d+)\)$/.exec(dataType);
    if (!constrainedDimensions) {
      return;
    }

    const expectedDimensions = Number(constrainedDimensions[1]);
    if (queryVectorDimensions !== expectedDimensions) {
      throw new AppError(
        `query_vector dimensions (${queryVectorDimensions}) must match ${target.schemaName}.${target.tableName}.${target.columnName} (${expectedDimensions})`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
  }

  private async executeVectorSearch(
    client: PoolClient,
    input: VectorSearchRequest,
    target: ResolvedVectorTarget
  ): Promise<VectorSearchResponse> {
    const operator = VECTOR_OPERATORS[input.metric];
    const tableReference = quoteQualifiedName(target.schemaName, target.tableName);
    const vectorColumn = `vector_source.${quoteIdentifier(target.columnName)}`;
    const distanceExpression = `${vectorColumn} ${operator} $1::vector`;
    const vectorLiteral = `[${input.query_vector.join(',')}]`;

    const result = await client.query<VectorSearchRow>(
      `
        SELECT
          row_to_json(vector_source) AS row,
          vector_distance.distance
        FROM ${tableReference} AS vector_source
        CROSS JOIN LATERAL (
          SELECT (${distanceExpression})::float8 AS distance
        ) AS vector_distance
        WHERE ${vectorColumn} IS NOT NULL
        ORDER BY vector_distance.distance
        LIMIT $2
      `,
      [vectorLiteral, input.top_k]
    );

    const matches = result.rows.map((match) => {
      const row = { ...match.row };
      if (!input.include_vector) {
        delete row[target.columnName];
      }

      const distance = Number(match.distance);
      const similarity = calculateSimilarity(input.metric, distance);

      return similarity === undefined
        ? { row, distance }
        : {
            row,
            distance,
            similarity,
          };
    });

    return {
      matches,
      count: matches.length,
      metric: input.metric,
    };
  }
}

function resolveVectorTarget(input: VectorSearchRequest): ResolvedVectorTarget {
  if (input.schema && input.table.includes('.')) {
    throw new AppError(
      'Provide either schema plus table, or a qualified table name, not both.',
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }

  const parsed = input.table.includes('.')
    ? splitQualifiedTableReference(input.table, DEFAULT_DATABASE_SCHEMA)
    : {
        schemaName: normalizeDatabaseSchemaName(input.schema),
        tableName: input.table,
      };

  const schemaName = normalizeDatabaseSchemaName(parsed.schemaName);
  assertWritableDatabaseSchema(schemaName);

  return {
    schemaName,
    tableName: parsed.tableName,
    // quoteIdentifier validates the column name before it is interpolated into SQL.
    columnName: input.column,
  };
}

function calculateSimilarity(metric: VectorSearchMetric, distance: number): number | undefined {
  if (metric === 'cosine') {
    return 1 - distance;
  }

  if (metric === 'inner_product') {
    return -distance;
  }

  return undefined;
}
