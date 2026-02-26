import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import logger from '@/utils/logger.js';
import { AIConfigurationSchema, AIConfigurationWithUsageSchema } from '@insforge/shared-schemas';

export class AIConfigService {
  private static instance: AIConfigService;
  private pool: Pool | null = null;

  private constructor() {}

  public static getInstance(): AIConfigService {
    if (!AIConfigService.instance) {
      AIConfigService.instance = new AIConfigService();
    }
    return AIConfigService.instance;
  }

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
    try {
      const result = await this.getPool().query(
        `INSERT INTO ai.configs (input_modality, output_modality, provider, model_id, system_prompt, is_active)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         ON CONFLICT (model_id) DO UPDATE
         SET input_modality = EXCLUDED.input_modality,
             output_modality = EXCLUDED.output_modality,
             provider = EXCLUDED.provider,
             system_prompt = COALESCE(EXCLUDED.system_prompt, ai.configs.system_prompt),
             is_active = TRUE,
             updated_at = NOW()
         RETURNING id`,
        [inputModality, outputModality, provider, modelId, systemPrompt || null]
      );

      logger.info('AI configuration enabled', { id: result.rows[0].id, modelId });
      return { id: result.rows[0].id };
    } catch (error) {
      logger.error('Failed to create AI configuration', { error });
      throw new Error('Failed to create AI configuration');
    }
  }

  /**
   * Check whether ai.configs has any rows, including inactive ones.
   * Used by bootstrap seed logic to avoid re-enabling intentionally disabled models.
   */
  async hasAnyConfig(): Promise<boolean> {
    try {
      const result = await this.getPool().query('SELECT 1 FROM ai.configs LIMIT 1');
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Failed to check AI configuration existence', { error });
      throw new Error('Failed to check AI configuration existence');
    }
  }

  async findAll(): Promise<AIConfigurationWithUsageSchema[]> {
    try {
      // Use a single query with aggregation to get configs with usage stats
      const result = await this.getPool().query(
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
         FROM ai.configs c
         LEFT JOIN ai.usage u ON c.id = u.config_id
         WHERE c.is_active = TRUE
         GROUP BY c.id, c.input_modality, c.output_modality, c.provider, c.model_id, c.system_prompt, c.created_at
         ORDER BY c.created_at DESC`
      );

      return result.rows.map((row) => ({
        id: row.id, // UUID
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
    }
  }

  async update(id: string, systemPrompt: string | null): Promise<boolean> {
    try {
      const result = await this.getPool().query(
        `UPDATE ai.configs
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
    }
  }

  async disable(id: string): Promise<boolean> {
    try {
      const result = await this.getPool().query(
        `UPDATE ai.configs
         SET is_active = FALSE, updated_at = NOW()
         WHERE id = $1`,
        [id]
      );

      const success = (result.rowCount ?? 0) > 0;
      if (success) {
        logger.info('AI configuration disabled', { id });
      }
      return success;
    } catch (error) {
      logger.error('Failed to disable AI configuration', { error, id });
      throw new Error('Failed to disable AI configuration');
    }
  }

  async findByModelId(modelId: string): Promise<AIConfigurationSchema | null> {
    try {
      const result = await this.getPool().query(
        `SELECT id, input_modality as "inputModality", output_modality as "outputModality", provider, model_id as "modelId", system_prompt as "systemPrompt", created_at, updated_at
         FROM ai.configs
         WHERE model_id = $1
           AND is_active = TRUE`,
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
