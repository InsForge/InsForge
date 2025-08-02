import { Router, Response, NextFunction } from 'express';
import { DatabaseManager } from '@/core/database/database.js';
import { verifyUserOrAdmin, AuthRequest } from '@/api/middleware/auth.js';
import { successResponse, paginatedResponse } from '@/utils/response.js';
import { LogRecord, LogActionStat, LogTableStat } from '@/types/logs.js';

const router = Router();

// All logs routes require admin authentication
router.use(verifyUserOrAdmin);

// GET /logs - List activity logs
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { limit = 100, offset = 0, action, table } = req.query;

    const dbManager = DatabaseManager.getInstance();
    const db = dbManager.getAppDb();

    // Build query with optional filters
    let query = 'SELECT * FROM logs WHERE 1=1';
    const params: (string | number)[] = [];

    if (action && typeof action === 'string') {
      query += ' AND action = ?';
      params.push(action);
    }

    if (table && typeof table === 'string') {
      query += ' AND table_name = ?';
      params.push(table);
    }

    // Add ordering and pagination
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const records = (await db.prepare(query).all(...params)) as LogRecord[];

    // Get total count
    let countQuery = 'SELECT COUNT(*) as count FROM logs WHERE 1=1';
    const countParams: string[] = [];

    if (action && typeof action === 'string') {
      countQuery += ' AND action = ?';
      countParams.push(action);
    }

    if (table && typeof table === 'string') {
      countQuery += ' AND table_name = ?';
      countParams.push(table);
    }

    const count = (await db.prepare(countQuery).get(...countParams)) as { count: number };

    paginatedResponse(res, records, count.count, Number(limit), Number(offset));
  } catch (error) {
    next(error);
  }
});

// GET /logs/stats - Get logs statistics
router.get('/stats', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const dbManager = DatabaseManager.getInstance();
    const db = dbManager.getAppDb();

    // Get action counts
    const actionStats = (await db
      .prepare(
        `
      SELECT action, COUNT(*) as count 
      FROM logs 
      GROUP BY action
    `
      )
      .all()) as LogActionStat[];

    // Get table activity
    const tableStats = (await db
      .prepare(
        `
      SELECT table_name, COUNT(*) as count 
      FROM logs 
      GROUP BY table_name
      ORDER BY count DESC
      LIMIT 10
    `
      )
      .all()) as LogTableStat[];

    // Get recent activity count (last 24 hours)
    const recentActivity = (await db
      .prepare(
        `
      SELECT COUNT(*) as count 
      FROM logs 
      WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '1 day'
    `
      )
      .get()) as { count: number };

    const totalLogs = (await db.prepare('SELECT COUNT(*) as count FROM logs').get()) as {
      count: number;
    };

    successResponse(res, {
      actionStats,
      tableStats,
      recentActivity: recentActivity.count,
      totalLogs: totalLogs.count,
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /logs - Clear logs (admin only)
router.delete('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { before } = req.query;

    const dbManager = DatabaseManager.getInstance();
    const db = dbManager.getAppDb();

    let result;
    if (before && typeof before === 'string') {
      // Delete logs before a specific date
      result = await db.prepare('DELETE FROM logs WHERE created_at < ?').run(before);
    } else {
      // Clear all logs
      result = await db.prepare('DELETE FROM logs').run();
    }

    successResponse(res, {
      message: 'Logs cleared successfully',
      deleted: result.changes,
    });
  } catch (error) {
    next(error);
  }
});

export { router as logsRouter };
