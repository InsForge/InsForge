import { Pool } from 'pg';
import { DatabaseManager } from '@/core/database/database.js';
import logger from '@/utils/logger.js';
import { AIConfigurationSchema, AIConfigurationWithUsageSchema } from '@insforge/shared-schemas';

export class AIConfigService {
  private pool: Pool | null = null;

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  async create(
    inputModality: string[],
    outputModality: string[],
    provider: string,
    modelId: string,
    systemPrompt?: string
  ): Promise<{ id: string }> {
    const client = await this.getPool().connect();
    try {
      const result = await client.query(
        `INSERT INTO _ai_configs (input_modality, output_modality, provider, model_id, system_prompt)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          JSON.stringify(inputModality),
          JSON.stringify(outputModality),
          provider,
          modelId,
          systemPrompt || null,
        ]
      );

      logger.info('AI configuration created', { id: result.rows[0].id });
      return { id: result.rows[0].id };
    } catch (error) {
      logger.error('Failed to create AI configuration', { error });
      throw new Error('Failed to create AI configuration');
    } finally {
      client.release();
    }
  }

  async findAll(): Promise<AIConfigurationWithUsageSchema[]> {
    const client = await this.getPool().connect();
    try {
      // Use a single query with aggregation to get configs with usage stats
      const result = await client.query(
        `SELECT 
          c.id,
          c.input_modality as "inputModality",
          c.output_modality as "outputModality",
          c.provider,
          c.model_id as "modelId",
          c.system_prompt as "systemPrompt",
          COALESCE(SUM(u.input_tokens), 0)::INTEGER as "totalInputTokens",
          COALESCE(SUM(u.output_tokens), 0)::INTEGER as "totalOutputTokens",
          COALESCE(SUM(u.input_tokens + u.output_tokens), 0)::INTEGER as "totalTokens",
          COALESCE(SUM(u.image_count), 0)::INTEGER as "totalImageCount",
          COALESCE(COUNT(u.id), 0)::INTEGER as "totalRequests"
         FROM _ai_configs c
         LEFT JOIN _ai_usage u ON c.id = u.config_id
         GROUP BY c.id, c.input_modality, c.output_modality, c.provider, c.model_id, c.system_prompt, c.created_at
         ORDER BY c.created_at DESC`
      );

      return result.rows.map((row) => ({
        id: row.id,
        inputModality: row.inputModality,
        outputModality: row.outputModality,
        provider: row.provider,
        modelId: row.modelId,
        systemPrompt: row.systemPrompt,
        usageStats: {
          totalInputTokens: row.totalInputTokens,
          totalOutputTokens: row.totalOutputTokens,
          totalTokens: row.totalTokens,
          totalImageCount: row.totalImageCount,
          totalRequests: row.totalRequests,
        },
      }));
    } catch (error) {
      logger.error('Failed to fetch AI configurations with usage', { error });
      throw new Error('Failed to fetch AI configurations');
    } finally {
      client.release();
    }
  }

  async update(id: string, systemPrompt: string | null): Promise<boolean> {
    const client = await this.getPool().connect();
    try {
      const result = await client.query(
        `UPDATE _ai_configs 
         SET system_prompt = $1, updated_at = NOW()
         WHERE id = $2`,
        [systemPrompt, id]
      );

      const success = (result.rowCount ?? 0) > 0;
      if (success) {
        logger.info('AI configuration updated', { id });
      }
      return success;
    } catch (error) {
      logger.error('Failed to update AI configuration', { error, id });
      throw new Error('Failed to update AI configuration');
    } finally {
      client.release();
    }
  }

  async delete(id: string): Promise<boolean> {
    const client = await this.getPool().connect();
    try {
      const result = await client.query('DELETE FROM _ai_configs WHERE id = $1', [id]);

      const success = (result.rowCount ?? 0) > 0;
      if (success) {
        logger.info('AI configuration deleted', { id });
      }
      return success;
    } catch (error) {
      logger.error('Failed to delete AI configuration', { error, id });
      throw new Error('Failed to delete AI configuration');
    } finally {
      client.release();
    }
  }

  async findByModelId(modelId: string): Promise<AIConfigurationSchema | null> {
    const client = await this.getPool().connect();
    try {
      const result = await client.query(
        `SELECT id, input_modality as "inputModality", output_modality as "outputModality", provider, model_id as "modelId", system_prompt as "systemPrompt", created_at, updated_at
         FROM _ai_configs
         WHERE model_id = $1`,
        [modelId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        inputModality: row.inputModality,
        outputModality: row.outputModality,
        provider: row.provider,
        modelId: row.modelId,
        systemPrompt: row.systemPrompt,
      };
    } catch (error) {
      logger.error('Failed to fetch AI configuration by modelId', {
        error,
        modelId,
      });
      throw new Error('Failed to fetch AI configuration');
    } finally {
      client.release();
    }
  }

  /**
   * Get AI metadata
   */
  async getMetadata(): Promise<{
    models: Array<{ inputModality: string[]; outputModality: string[]; modelId: string }>;
  }> {
    try {
      const configs = await this.findAll();

      // Map configs to simplified model metadata
      const models = configs.map((config) => ({
        inputModality: config.inputModality,
        outputModality: config.outputModality,
        modelId: config.modelId,
      }));

      return { models };
    } catch (error) {
      logger.error('Failed to get AI metadata', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { models: [] };
    }
  }
}
