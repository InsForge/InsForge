import { Router, Response, NextFunction } from 'express';
import { AuthRequest, verifyAdmin } from '@/api/middlewares/auth.js';
import { paginatedResponse } from '@/utils/response.js';
import { DatabaseBrowseService } from '@/services/database/database-browse.service.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';

const router = Router();
const browseService = DatabaseBrowseService.getInstance();

function parseInteger(value: unknown, fallback: number) {
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new AppError(
      `Invalid numeric query parameter: ${value}`,
      400,
      ERROR_CODES.INVALID_INPUT,
      'Please provide numeric values for limit and offset.'
    );
  }

  return parsed;
}

router.use(verifyAdmin);

router.get('/:tableName', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tableName } = req.params;
    const offset = parseInteger(req.query.offset, 0);
    const result = await browseService.browseTable(tableName, {
      limit: parseInteger(req.query.limit, 10),
      offset,
      order: typeof req.query.order === 'string' ? req.query.order : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
    });

    paginatedResponse(res, result.rows, result.total, offset);
  } catch (error) {
    next(error);
  }
});

export { router as databaseBrowseRouter };
