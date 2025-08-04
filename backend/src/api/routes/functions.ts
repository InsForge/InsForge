import { Router, Response } from 'express';
import { z } from 'zod';
import { AuthRequest, verifyAdmin } from '@/api/middleware/auth.js';
import { DatabaseManager } from '@/core/database/database.js';
import { DatabaseError } from 'pg';
import logger from '@/utils/logger.js';

const router = Router();
const db = DatabaseManager.getInstance();

// Schema for function upload
const functionUploadSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Invalid name format'),
  slug: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid slug format')
    .optional(),
  code: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(['draft', 'active']).optional().default('draft'),
});

// Schema for function update
const functionUpdateSchema = z.object({
  name: z.string().optional(),
  code: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['draft', 'active', 'error']).optional(),
});

/**
 * GET /api/functions
 * List all edge functions
 */
router.get('/', verifyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const functions = await db
      .prepare(
        `SELECT 
          id, slug, name, description, status, 
          created_at, updated_at, deployed_at
        FROM _edge_functions
        ORDER BY created_at DESC`
      )
      .all();

    res.json(functions);
  } catch (error) {
    logger.error('Failed to list functions', {
      error: error instanceof Error ? error.message : String(error),
      operation: 'listFunctions',
    });
    res.status(500).json({ error: 'Failed to list functions' });
  }
});

/**
 * GET /api/functions/:slug
 * Get specific function details including code
 */
router.get('/:slug', verifyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;

    const func = await db
      .prepare(
        `
      SELECT 
        id, slug, name, description, code, status,
        created_at, updated_at, deployed_at
      FROM _edge_functions
      WHERE slug = ?
    `
      )
      .get(slug);

    if (!func) {
      return res.status(404).json({ error: 'Function not found' });
    }

    res.json(func);
  } catch (error) {
    logger.error('Failed to get function', {
      error: error instanceof Error ? error.message : String(error),
      operation: 'getFunction',
      slug: req.params.slug,
    });
    res.status(500).json({ error: 'Failed to get function' });
  }
});

/**
 * POST /api/functions
 * Create a new function
 */
router.post('/', verifyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const validation = functionUploadSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request',
        details: validation.error.issues,
      });
    }

    const { name, code, description, status } = validation.data;
    const slug = validation.data.slug || name.toLowerCase().replace(/\s+/g, '-');

    // Basic security validation
    const dangerousPatterns = [
      /Deno\.run/i,
      /Deno\.spawn/i,
      /Deno\.Command/i,
      /child_process/i,
      /process\.exit/i,
      /require\(['"]fs['"]\)/i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        return res.status(400).json({
          error: 'Code contains potentially dangerous patterns',
          pattern: pattern.toString(),
        });
      }
    }

    // Generate UUID
    const id = crypto.randomUUID();

    // Insert function
    await db
      .prepare(
        `
      INSERT INTO _edge_functions (id, slug, name, description, code, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(id, slug, name, description || null, code, status);

    // If status is active, update deployed_at
    if (status === 'active') {
      await db
        .prepare(
          `
        UPDATE _edge_functions SET deployed_at = CURRENT_TIMESTAMP WHERE id = ?
      `
        )
        .run(id);
    }

    // Fetch the created function
    const created = await db
      .prepare(
        `
      SELECT id, slug, name, description, status, created_at
      FROM _edge_functions WHERE id = ?
    `
      )
      .get(id);

    // Log function creation for audit purposes, this is required before finishing serverless function completely
    logger.info(`Function ${name} (${slug}) created by ${req.user?.email}`);

    res.status(201).json({
      success: true,
      function: created,
    });
  } catch (error) {
    logger.error('Failed to create function', {
      error: error instanceof Error ? error.message : String(error),
      operation: 'createFunction',
    });

    // PostgreSQL unique constraint error
    if (error instanceof DatabaseError && error.code === '23505') {
      return res.status(409).json({
        error: 'Function with this slug already exists',
        details: error.message,
      });
    }

    res.status(500).json({
      error: 'Failed to create function',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
});

/**
 * PUT /api/functions/:slug
 * Update an existing function
 */
router.put('/:slug', verifyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;
    const validation = functionUpdateSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request',
        details: validation.error.issues,
      });
    }

    const updates = validation.data;

    // Check if function exists
    const existing = await db.prepare('SELECT id FROM _edge_functions WHERE slug = ?').get(slug);
    if (!existing) {
      return res.status(404).json({ error: 'Function not found' });
    }

    // Update fields
    if (updates.name !== undefined) {
      await db
        .prepare('UPDATE _edge_functions SET name = ? WHERE slug = ?')
        .run(updates.name, slug);
    }

    if (updates.description !== undefined) {
      await db
        .prepare('UPDATE _edge_functions SET description = ? WHERE slug = ?')
        .run(updates.description, slug);
    }

    if (updates.code !== undefined) {
      await db
        .prepare('UPDATE _edge_functions SET code = ? WHERE slug = ?')
        .run(updates.code, slug);
    }

    if (updates.status !== undefined) {
      await db
        .prepare('UPDATE _edge_functions SET status = ? WHERE slug = ?')
        .run(updates.status, slug);

      // Update deployed_at if status changes to active
      if (updates.status === 'active') {
        await db
          .prepare('UPDATE _edge_functions SET deployed_at = CURRENT_TIMESTAMP WHERE slug = ?')
          .run(slug);
      }
    }

    // Update updated_at
    await db
      .prepare('UPDATE _edge_functions SET updated_at = CURRENT_TIMESTAMP WHERE slug = ?')
      .run(slug);

    // Fetch updated function
    const updated = await db
      .prepare(
        `
      SELECT id, slug, name, description, status, updated_at
      FROM _edge_functions WHERE slug = ?
    `
      )
      .get(slug);

    // Log function update for audit purposes, this is required before finishing serverless function completely
    logger.info(`Function ${slug} updated by ${req.user?.email}`);

    res.json({
      success: true,
      function: updated,
    });
  } catch (error) {
    logger.error('Failed to update function', {
      error: error instanceof Error ? error.message : String(error),
      operation: 'updateFunction',
      slug: req.params.slug,
    });
    res.status(500).json({ error: 'Failed to update function' });
  }
});

/**
 * DELETE /api/functions/:slug
 * Delete a function
 */
router.delete('/:slug', verifyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;

    const result = await db.prepare('DELETE FROM _edge_functions WHERE slug = ?').run(slug);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Function not found' });
    }

    // Log function deletion for audit purposes, this is required before finishing serverless function completely
    logger.info(`Function ${slug} deleted by ${req.user?.email}`);

    res.json({
      success: true,
      message: `Function ${slug} deleted successfully`,
    });
  } catch (error) {
    logger.error('Failed to delete function', {
      error: error instanceof Error ? error.message : String(error),
      operation: 'deleteFunction',
      slug: req.params.slug,
    });
    res.status(500).json({ error: 'Failed to delete function' });
  }
});

export default router;
