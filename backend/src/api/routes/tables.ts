import { Router, Response, NextFunction } from 'express';
import { verifyUserOrApiKey, AuthRequest } from '@/api/middleware/auth.js';
import { TablesController } from '@/controllers/TablesController.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/api/middleware/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { CreateTableRequest, UpdateTableSchemaRequest } from '@/types/database.js';

const router = Router();
const tablesController = new TablesController();

// All table routes accept either JWT token or API key authentication
router.use(verifyUserOrApiKey);

// List all tables
router.get('/', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const tables = await tablesController.listTables();
    successResponse(res, tables);
  } catch (error) {
    next(error);
  }
});

// Create a new table
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const requestData: CreateTableRequest = req.body;
    const { table_name, columns, rls_decl } = requestData;

    // Validate required fields
    if (!table_name || !columns || !Array.isArray(columns)) {
      throw new AppError(
        'table_name and columns array are required',
        400,
        ERROR_CODES.MISSING_FIELD,
        'table_name and columns array are required. Please check the request body, table_name and columns are required'
      );
    }

    const use_RLS = rls_decl !== undefined ? rls_decl : true;
    const result = await tablesController.createTable(table_name, columns, use_RLS);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
});

// Get table schema
router.get('/:table/schema', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { table } = req.params;
    const schema = await tablesController.getTableSchema(table);
    successResponse(res, schema);
  } catch (error) {
    next(error);
  }
});

// Update table schema
router.patch('/:table', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { table } = req.params;
    const operations: UpdateTableSchemaRequest = req.body;

    if (
      !operations.add_columns &&
      !operations.drop_columns &&
      !operations.rename_columns &&
      !operations.add_fkey_columns &&
      !operations.drop_fkey_columns
    ) {
      throw new AppError(
        'At least one operation (add_columns, drop_columns, rename_columns, add_fkey_columns, drop_fkey_columns) is required',
        400,
        ERROR_CODES.MISSING_FIELD,
        'Please check the request body, at least one operation(add_columns, drop_columns, rename_columns, add_fkey_columns, drop_fkey_columns) is required'
      );
    }

    const result = await tablesController.updateTableSchema(table, operations);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
});

// Delete a table
router.delete('/:table', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { table } = req.params;
    const result = await tablesController.deleteTable(table);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
});

export { router as tablesRouter };
