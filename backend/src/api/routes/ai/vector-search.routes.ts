import { Router, Response, NextFunction } from 'express';
import { AuthRequest, verifyUser } from '../../middlewares/auth.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';

const router = Router();

/**
 * POST /api/ai/vector/search
 * Perform semantic vector search using pgvector
 */
router.post('/search', verifyUser, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { table, column, query_vector, top_k = 5 } = req.body;

    if (!table || !column || !query_vector || !Array.isArray(query_vector)) {
      throw new AppError(
        'Missing required fields: table, column, query_vector',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    if (typeof top_k !== 'number' || top_k < 1 || top_k > 100) {
      throw new AppError(
        'top_k must be a number between 1 and 100',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const pool = DatabaseManager.getInstance().getPool();
    const db = await pool.connect();
    const vectorStr = `[${query_vector.join(',')}]`;

    try {
      const result = await db.query(
        `SELECT *, 1 - (${column} <=> $1::vector) AS similarity
         FROM ${table}
         ORDER BY ${column} <=> $1::vector
         LIMIT $2`,
        [vectorStr, top_k]
      );
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