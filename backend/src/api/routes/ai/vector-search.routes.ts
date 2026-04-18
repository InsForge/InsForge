import { Router, Response, NextFunction } from 'express';
import { AuthRequest, verifyUser } from '../../middlewares/auth.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { z } from 'zod';
import pgFormat from 'pg-format';

const router = Router();

// Zod schema with camelCase fields and proper validation
const vectorSearchRequestSchema = z.object({
  table: z.string().min(1),
  column: z.string().min(1),
  queryVector: z.array(z.number().finite()).min(1),
  topK: z.number().int().min(1).max(100).default(5),
});

// Allowlist of valid identifier characters — prevents SQL injection
const VALID_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * POST /api/ai/vector/search
 * Perform semantic vector search using pgvector
 */
router.post('/search', verifyUser, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validationResult = vectorSearchRequestSchema.safeParse(req.body);

    if (!validationResult.success) {
      throw new AppError(
        `Validation error: ${validationResult.error.errors.map((e) => e.message).join(', ')}`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const { table, column, queryVector, topK } = validationResult.data;

    // Validate table and column against allowlist to prevent SQL injection
    if (!VALID_IDENTIFIER.test(table)) {
      throw new AppError(
        'Invalid table name. Only alphanumeric characters and underscores are allowed.',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    if (!VALID_IDENTIFIER.test(column)) {
      throw new AppError(
        'Invalid column name. Only alphanumeric characters and underscores are allowed.',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const pool = DatabaseManager.getInstance().getPool();
    const db = await pool.connect();
    const vectorStr = `[${queryVector.join(',')}]`;

    // Use pg-format to safely quote identifiers
    const query = pgFormat(
      `SELECT *, 1 - (%I <=> $1::vector) AS similarity
       FROM %I
       ORDER BY %I <=> $1::vector
       LIMIT $2`,
      column,
      table,
      column
    );

    try {
      const result = await db.query(query, [vectorStr, topK]);
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