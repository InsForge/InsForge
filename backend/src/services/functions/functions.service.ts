import { DatabaseManager } from '@/infra/database/manager.js';
import {
  EdgeFunctionMetadataSchema,
  FunctionUploadRequest,
  FunctionUpdateRequest,
} from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';
import { DatabaseError } from 'pg';
import fetch from 'node-fetch';
import { AppError } from '@/api/middleware/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';

export interface FunctionWithRuntime {
  functions: Record<string, unknown>[];
  runtime: {
    status: 'running' | 'unavailable';
  };
}

export class FunctionService {
  private static instance: FunctionService;
  private db;

  private constructor() {
    this.db = DatabaseManager.getInstance();
  }

  static getInstance(): FunctionService {
    if (!FunctionService.instance) {
      FunctionService.instance = new FunctionService();
    }
    return FunctionService.instance;
  }

  /**
   * List all functions with runtime health check
   */
  async listFunctions(): Promise<FunctionWithRuntime> {
    try {
      const functions = await this.db
        .prepare(
          `SELECT 
            id, slug, name, description, status, 
            created_at, updated_at, deployed_at
          FROM _functions
          ORDER BY created_at DESC`
        )
        .all();

      // Check if Deno runtime is healthy
      let runtimeHealthy = false;
      try {
        const denoUrl = process.env.DENO_RUNTIME_URL || 'http://localhost:7133';
        const healthResponse = await fetch(`${denoUrl}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(2000), // 2 second timeout
        });
        runtimeHealthy = healthResponse.ok;
      } catch (error) {
        logger.debug('Deno runtime health check failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return {
        functions,
        runtime: {
          status: runtimeHealthy ? 'running' : 'unavailable',
        },
      };
    } catch (error) {
      logger.error('Failed to list functions', {
        error: error instanceof Error ? error.message : String(error),
        operation: 'listFunctions',
      });
      throw error;
    }
  }

  /**
   * Get a specific function by slug
   */
  async getFunction(slug: string): Promise<Record<string, unknown> | undefined> {
    try {
      const func = await this.db
        .prepare(
          `SELECT 
            id, slug, name, description, code, status,
            created_at, updated_at, deployed_at
          FROM _functions
          WHERE slug = ?`
        )
        .get(slug);

      return func;
    } catch (error) {
      logger.error('Failed to get function', {
        error: error instanceof Error ? error.message : String(error),
        operation: 'getFunction',
        slug,
      });
      throw error;
    }
  }

  /**
   * Create a new function
   */
  async createFunction(data: FunctionUploadRequest): Promise<Record<string, unknown>> {
    try {
      const { name, code, description, status } = data;
      const slug = data.slug || name.toLowerCase().replace(/\s+/g, '-');

      // Basic security validation
      this.validateCode(code);

      // Generate UUID
      const id = crypto.randomUUID();

      // Insert function
      await this.db
        .prepare(
          `INSERT INTO _functions (id, slug, name, description, code, status)
          VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(id, slug, name, description || null, code, status);

      // If status is active, update deployed_at
      if (status === 'active') {
        await this.db
          .prepare(`UPDATE _functions SET deployed_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(id);
      }

      // Fetch the created function
      const created = await this.db
        .prepare(
          `SELECT id, slug, name, description, status, created_at
          FROM _functions WHERE id = ?`
        )
        .get(id);

      return created;
    } catch (error) {
      // Re-throw AppErrors as-is
      if (error instanceof AppError) {
        throw error;
      }

      logger.error('Failed to create function', {
        error: error instanceof Error ? error.message : String(error),
        operation: 'createFunction',
      });

      // Handle unique constraint error
      if (error instanceof DatabaseError && error.code === '23505') {
        throw new AppError(
          'Function with this slug already exists',
          409,
          ERROR_CODES.ALREADY_EXISTS
        );
      }

      throw error;
    }
  }

  /**
   * Update an existing function
   */
  async updateFunction(
    slug: string,
    updates: FunctionUpdateRequest
  ): Promise<Record<string, unknown> | null> {
    try {
      // Check if function exists
      const existing = await this.db.prepare('SELECT id FROM _functions WHERE slug = ?').get(slug);
      if (!existing) {
        return null;
      }

      // Validate code if provided
      if (updates.code !== undefined) {
        this.validateCode(updates.code);
      }

      // Update fields
      if (updates.name !== undefined) {
        await this.db
          .prepare('UPDATE _functions SET name = ? WHERE slug = ?')
          .run(updates.name, slug);
      }

      if (updates.description !== undefined) {
        await this.db
          .prepare('UPDATE _functions SET description = ? WHERE slug = ?')
          .run(updates.description, slug);
      }

      if (updates.code !== undefined) {
        await this.db
          .prepare('UPDATE _functions SET code = ? WHERE slug = ?')
          .run(updates.code, slug);
      }

      if (updates.status !== undefined) {
        await this.db
          .prepare('UPDATE _functions SET status = ? WHERE slug = ?')
          .run(updates.status, slug);

        // Update deployed_at if status changes to active
        if (updates.status === 'active') {
          await this.db
            .prepare('UPDATE _functions SET deployed_at = CURRENT_TIMESTAMP WHERE slug = ?')
            .run(slug);
        }
      }

      // Update updated_at
      await this.db
        .prepare('UPDATE _functions SET updated_at = CURRENT_TIMESTAMP WHERE slug = ?')
        .run(slug);

      // Fetch updated function
      const updated = await this.db
        .prepare(
          `SELECT id, slug, name, description, status, updated_at
          FROM _functions WHERE slug = ?`
        )
        .get(slug);

      return updated;
    } catch (error) {
      logger.error('Failed to update function', {
        error: error instanceof Error ? error.message : String(error),
        operation: 'updateFunction',
        slug,
      });
      throw error;
    }
  }

  /**
   * Delete a function
   */
  async deleteFunction(slug: string): Promise<boolean> {
    try {
      const result = await this.db.prepare('DELETE FROM _functions WHERE slug = ?').run(slug);

      if (result.changes === 0) {
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Failed to delete function', {
        error: error instanceof Error ? error.message : String(error),
        operation: 'deleteFunction',
        slug,
      });
      throw error;
    }
  }

  /**
   * Get functions metadata (public method for non-admin users)
   */
  async getMetadata(): Promise<Array<EdgeFunctionMetadataSchema>> {
    try {
      const functions = await this.db
        .prepare(
          `SELECT slug, name, description, status
          FROM _functions
          ORDER BY created_at DESC`
        )
        .all();

      return functions as Array<EdgeFunctionMetadataSchema>;
    } catch (error) {
      logger.error('Failed to get edge functions metadata', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Validate function code for dangerous patterns
   */
  private validateCode(code: string): void {
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
        throw new AppError(
          `Code contains potentially dangerous pattern: ${pattern.toString()}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }
    }
  }
}
