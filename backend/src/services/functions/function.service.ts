import { DatabaseManager } from '@/infra/database/database.manager.js';
import {
  EdgeFunctionMetadataSchema,
  FunctionUploadRequest,
  FunctionUpdateRequest,
  FunctionSchema,
  FunctionListResponse,
} from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';
import { DatabaseError, Pool } from 'pg';
import fetch from 'node-fetch';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';

export class FunctionService {
  private static instance: FunctionService;
  private pool: Pool | null = null;

  private constructor() {}

  static getInstance(): FunctionService {
    if (!FunctionService.instance) {
      FunctionService.instance = new FunctionService();
    }
    return FunctionService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      const dbManager = DatabaseManager.getInstance();
      this.pool = dbManager.getPool();
    }
    return this.pool;
  }

  /**
   * List all functions with runtime health check
   */
  async listFunctions(): Promise<FunctionListResponse> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          slug,
          name,
          description,
          status,
          created_at as "createdAt",
          updated_at as "updatedAt",
          deployed_at as "deployedAt"
        FROM functions.definitions
        ORDER BY created_at DESC`
      );

      const functions = result.rows;

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
  async getFunction(slug: string): Promise<FunctionSchema | undefined> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          slug,
          name,
          description,
          code,
          status,
          created_at as "createdAt",
          updated_at as "updatedAt",
          deployed_at as "deployedAt"
        FROM functions.definitions
        WHERE slug = $1`,
        [slug]
      );

      return result.rows[0];
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
  async createFunction(data: FunctionUploadRequest): Promise<FunctionSchema> {
    const client = await this.getPool().connect();
    try {
      const { name, code, description, status } = data;
      const slug = data.slug || name.toLowerCase().replace(/\s+/g, '-');

      // Basic security validation
      this.validateCode(code);

      // Generate UUID
      const id = crypto.randomUUID();

      // Insert function
      await client.query(
        `INSERT INTO functions.definitions (id, slug, name, description, code, status)
        VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, slug, name, description || null, code, status]
      );

      // If status is active, update deployed_at
      if (status === 'active') {
        await client.query(
          `UPDATE functions.definitions SET deployed_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [id]
        );
      }

      // Fetch the created function
      const result = await client.query(
        `SELECT id, slug, name, description, status, created_at as "createdAt"
        FROM functions.definitions WHERE id = $1`,
        [id]
      );

      return result.rows[0];
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
    } finally {
      client.release();
    }
  }

  /**
   * Update an existing function
   */
  async updateFunction(
    slug: string,
    updates: FunctionUpdateRequest
  ): Promise<FunctionSchema | null> {
    const client = await this.getPool().connect();
    try {
      // Check if function exists
      const existingResult = await client.query(
        'SELECT id FROM functions.definitions WHERE slug = $1',
        [slug]
      );
      if (existingResult.rows.length === 0) {
        return null;
      }

      // Validate code if provided
      if (updates.code !== undefined) {
        this.validateCode(updates.code);
      }

      // Update fields
      if (updates.name !== undefined) {
        await client.query('UPDATE functions.definitions SET name = $1 WHERE slug = $2', [
          updates.name,
          slug,
        ]);
      }

      if (updates.description !== undefined) {
        await client.query('UPDATE functions.definitions SET description = $1 WHERE slug = $2', [
          updates.description,
          slug,
        ]);
      }

      if (updates.code !== undefined) {
        await client.query('UPDATE functions.definitions SET code = $1 WHERE slug = $2', [
          updates.code,
          slug,
        ]);
      }

      if (updates.status !== undefined) {
        await client.query('UPDATE functions.definitions SET status = $1 WHERE slug = $2', [
          updates.status,
          slug,
        ]);

        // Update deployed_at if status changes to active
        if (updates.status === 'active') {
          await client.query(
            'UPDATE functions.definitions SET deployed_at = CURRENT_TIMESTAMP WHERE slug = $1',
            [slug]
          );
        }
      }

      // Update updated_at
      await client.query(
        'UPDATE functions.definitions SET updated_at = CURRENT_TIMESTAMP WHERE slug = $1',
        [slug]
      );

      // Fetch updated function
      const result = await client.query(
        `SELECT id, slug, name, description, status, updated_at as "updatedAt", deployed_at as "deployedAt"
        FROM functions.definitions WHERE slug = $1`,
        [slug]
      );

      return result.rows[0];
    } catch (error) {
      logger.error('Failed to update function', {
        error: error instanceof Error ? error.message : String(error),
        operation: 'updateFunction',
        slug,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete a function
   */
  async deleteFunction(slug: string): Promise<boolean> {
    try {
      const result = await this.getPool().query(
        'DELETE FROM functions.definitions WHERE slug = $1',
        [slug]
      );

      if (result.rowCount === 0) {
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
      const result = await this.getPool().query(
        `SELECT slug, name, description, status
        FROM functions.definitions
        ORDER BY created_at DESC`
      );

      return result.rows as Array<EdgeFunctionMetadataSchema>;
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
