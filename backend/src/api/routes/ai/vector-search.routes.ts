import { Router, Response, NextFunction } from 'express';
import { AuthRequest, verifyUser } from '../../middlewares/auth.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import pgFormat from 'pg-format';

const router = Router();
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseVectorSearchAllowlist(raw: string | undefined): Map<string, Set<string>> {
  const allowlist = new Map<string, Set<string>>();
  if (!raw) {
    return allowlist;
  }

  for (const entry of raw.split(';')) {
    const trimmedEntry = entry.trim();
    if (!trimmedEntry) {
      continue;
    }

    const [tableName, columnsRaw] = trimmedEntry.split(':');
    if (!tableName || !columnsRaw) {
      continue;
    }

    const table = tableName.trim();
    if (!IDENTIFIER_PATTERN.test(table)) {
      continue;
    }

    const allowedColumns = columnsRaw
      .split(',')
      .map((column) => column.trim())
      .filter((column) => IDENTIFIER_PATTERN.test(column));

    if (allowedColumns.length > 0) {
      allowlist.set(table, new Set(allowedColumns));
    }
  }

  return allowlist;
}

function getScopedProjectId(req: AuthRequest): string {
  const projectId = req.projectId || process.env.PROJECT_ID;
  if (!projectId) {
    throw new AppError(
      'Project scope is required for vector search',
      403,
      ERROR_CODES.AUTH_UNAUTHORIZED
    );
  }
  return projectId;
}

function validateQueryVector(queryVector: unknown): number[] {
  if (!Array.isArray(queryVector) || queryVector.length === 0) {
    throw new AppError(
      'query_vector must be a non-empty numeric array',
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }

  const parsedVector = queryVector.map((value) => Number(value));
  const hasInvalidValue = parsedVector.some((value) => !Number.isFinite(value));
  if (hasInvalidValue) {
    throw new AppError(
      'query_vector must contain only finite numbers',
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }

  return parsedVector;
}

/**
 * POST /api/ai/vector/search
 * Perform semantic vector search using pgvector
 */
router.post('/search', verifyUser, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { table, column, query_vector, top_k = 5 } = req.body;
    const allowlist = parseVectorSearchAllowlist(process.env.AI_VECTOR_SEARCH_ALLOWLIST);
    const projectId = getScopedProjectId(req);

    if (allowlist.size === 0) {
      throw new AppError(
        'Vector search allowlist is not configured',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    if (typeof table !== 'string' || typeof column !== 'string') {
      throw new AppError(
        'Missing required fields: table, column, query_vector',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    if (!IDENTIFIER_PATTERN.test(table) || !IDENTIFIER_PATTERN.test(column)) {
      throw new AppError('Invalid table or column identifier', 400, ERROR_CODES.INVALID_INPUT);
    }

    if (typeof top_k !== 'number' || top_k < 1 || top_k > 100) {
      throw new AppError(
        'top_k must be a number between 1 and 100',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const allowedColumns = allowlist.get(table);
    if (!allowedColumns || !allowedColumns.has(column)) {
      throw new AppError(
        'Table/column not registered for vector search',
        403,
        ERROR_CODES.FORBIDDEN
      );
    }

    const validatedVector = validateQueryVector(query_vector);
    const pool = DatabaseManager.getInstance().getPool();
    const db = await pool.connect();
    const vectorStr = `[${validatedVector.join(',')}]`;

    try {
      const safeTable = pgFormat.ident(table);
      const safeColumn = pgFormat.ident(column);
      const query = `
        SELECT *, 1 - (${safeColumn} <=> $1::vector) AS similarity
        FROM ${safeTable}
        WHERE project_id = $2
        ORDER BY ${safeColumn} <=> $1::vector
        LIMIT $3
      `;
      const result = await db.query(query, [vectorStr, projectId, top_k]);
      successResponse(res, { results: result.rows });
    } finally {
      db.release();
    }
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(
        new AppError(
          error instanceof Error ? error.message : 'Vector search failed',
          500,
          ERROR_CODES.INTERNAL_ERROR
        )
      );
    }
  }
});

export { router as vectorSearchRouter };
