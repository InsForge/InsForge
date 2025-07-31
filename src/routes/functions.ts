import { Router, Response } from 'express';
import { z } from 'zod';
import { AuthRequest, verifyAdmin } from '../middleware/auth.js';
import { DatabaseManager } from '../services/database.js';
import { VaultService } from '../services/vault.js';
import { DatabaseError } from 'pg';

const router = Router();
const db = DatabaseManager.getInstance();
const vaultService = new VaultService(db);

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
          created_at, updated_at, deployed_at, created_by
        FROM _edge_functions
        ORDER BY created_at DESC`
      )
      .all();

    res.json(functions);
  } catch (error) {
    console.error('Failed to list functions:', error);
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
        created_at, updated_at, deployed_at, created_by
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
    console.error('Failed to get function:', error);
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
        details: validation.error.errors,
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
      INSERT INTO _edge_functions (id, slug, name, description, code, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(id, slug, name, description || null, code, status, req.user?.id || null);

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
    // eslint-disable-next-line no-console
    console.log(`Function ${name} (${slug}) created by ${req.user?.email}`);

    res.status(201).json({
      success: true,
      function: created,
    });
  } catch (error) {
    console.error('Failed to create function:', error);

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
        details: validation.error.errors,
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

    // Log function creation for audit purposes, this is required before finishing serverless function completely
    // eslint-disable-next-line no-console
    console.log(`Function ${slug} updated by ${req.user?.email}`);

    res.json({
      success: true,
      function: updated,
    });
  } catch (error) {
    console.error('Failed to update function:', error);
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

    // Log function creation for audit purposes, this is required before finishing serverless function completely
    // eslint-disable-next-line no-console
    console.log(`Function ${slug} deleted by ${req.user?.email}`);

    res.json({
      success: true,
      message: `Function ${slug} deleted successfully`,
    });
  } catch (error) {
    console.error('Failed to delete function:', error);
    res.status(500).json({ error: 'Failed to delete function' });
  }
});

/**
 * GET /api/functions/:slug/secrets
 * List secrets associated with a function
 */
router.get('/:slug/secrets', verifyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;
    
    // Get function by slug
    const func = await db
      .prepare('SELECT id FROM _edge_functions WHERE slug = ?')
      .get(slug);
      
    if (!func) {
      return res.status(404).json({ error: 'Function not found' });
    }
    
    // Get associated secrets
    const secrets = await db
      .prepare(`
        SELECT v.id, v.name, v.description
        FROM _vault v
        JOIN _function_secrets fs ON v.id = fs.vault_id
        WHERE fs.function_id = ?
        ORDER BY v.name
      `)
      .all(func.id);
      
    res.json(secrets);
  } catch (error) {
    console.error('Failed to list function secrets:', error);
    res.status(500).json({ error: 'Failed to list function secrets' });
  }
});

/**
 * POST /api/functions/:slug/secrets
 * Associate a secret with a function
 */
router.post('/:slug/secrets', verifyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;
    const { secretName } = req.body;
    
    if (!secretName) {
      return res.status(400).json({ error: 'Secret name is required' });
    }
    
    // Get function by slug
    const func = await db
      .prepare('SELECT id FROM _edge_functions WHERE slug = ?')
      .get(slug);
      
    if (!func) {
      return res.status(404).json({ error: 'Function not found' });
    }
    
    // Link secret to function
    await vaultService.linkSecretToFunction(secretName, func.id, req.user!.id);
    
    res.status(201).json({ 
      success: true,
      message: `Secret ${secretName} linked to function ${slug}` 
    });
  } catch (error) {
    console.error('Failed to link secret to function:', error);
    
    if (error instanceof Error && error.message === 'Secret not found') {
      return res.status(404).json({ error: 'Secret not found' });
    }
    
    res.status(500).json({ error: 'Failed to link secret to function' });
  }
});

/**
 * DELETE /api/functions/:slug/secrets/:secretName
 * Remove secret association from a function
 */
router.delete('/:slug/secrets/:secretName', verifyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { slug, secretName } = req.params;
    
    // Get function by slug
    const func = await db
      .prepare('SELECT id FROM _edge_functions WHERE slug = ?')
      .get(slug);
      
    if (!func) {
      return res.status(404).json({ error: 'Function not found' });
    }
    
    // Unlink secret from function
    await vaultService.unlinkSecretFromFunction(secretName, func.id, req.user!.id);
    
    res.json({ 
      success: true,
      message: `Secret ${secretName} unlinked from function ${slug}` 
    });
  } catch (error) {
    console.error('Failed to unlink secret from function:', error);
    res.status(500).json({ error: 'Failed to unlink secret from function' });
  }
});

export default router;
