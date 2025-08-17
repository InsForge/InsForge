import { Router } from 'express';
import { DatabaseManager } from '@/core/database/database.js';
import { verifyApiKey, verifyCloudBackend } from '@/api/middleware/auth.js';

export const usageRouter = Router();

// Create MCP tool usage record
usageRouter.post('/mcp', verifyApiKey, async (req, res, next) => {
  try {
    const { tool_name, success = true } = req.body;

    if (!tool_name) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'tool_name is required',
      });
    }

    const dbManager = DatabaseManager.getInstance();
    const db = dbManager.getDb();

    // Insert MCP usage record directly
    await db
      .prepare(
        `
      INSERT INTO _mcp_usage (tool_name, success) 
      VALUES ($1, $2)
    `
      )
      .run(tool_name, success);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Get usage statistics (called by cloud backend)
usageRouter.get('/stats', verifyCloudBackend, async (req, res, next) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'start_date and end_date are required',
      });
    }

    const dbManager = DatabaseManager.getInstance();
    const db = dbManager.getDb();

    // Get MCP tool usage count within date range
    const endDatePlusOne = new Date(end_date as string);
    endDatePlusOne.setDate(endDatePlusOne.getDate() + 1);

    const mcpResult = await db
      .prepare(
        `
      SELECT COUNT(*) as count 
      FROM _mcp_usage 
      WHERE success = true 
        AND created_at >= $1 
        AND created_at < $2
    `
      )
      .get(new Date(start_date as string), endDatePlusOne);
    const mcpUsageCount = parseInt(mcpResult?.count || '0');

    // Get database size (in bytes)
    const dbSizeResult = await db
      .prepare(
        `
      SELECT pg_database_size(current_database()) as size
    `
      )
      .get();
    const databaseSize = parseInt(dbSizeResult?.size || '0');

    // Get total storage size from _storage table
    const storageResult = await db
      .prepare(
        `
      SELECT COALESCE(SUM(size), 0) as total_size
      FROM _storage
    `
      )
      .get();
    const storageSize = parseInt(storageResult?.total_size || '0');

    res.json({
      mcp_usage_count: mcpUsageCount,
      database_size_bytes: databaseSize,
      storage_size_bytes: storageSize,
    });
  } catch (error) {
    next(error);
  }
});
