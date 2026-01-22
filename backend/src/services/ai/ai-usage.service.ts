import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import logger from '@/utils/logger.js';
import type {
  AIUsageDataSchema,
  AIUsageRecordSchema,
  AIUsageSummarySchema,
  ListAIUsageResponse,
} from '@insforge/shared-schemas';

export class AIUsageService {
  private static instance: AIUsageService;
  private pool: Pool | null = null;

  private constructor() {}

  public static getInstance(): AIUsageService {
    if (!AIUsageService.instance) {
      AIUsageService.instance = new AIUsageService();
    }
    return AIUsageService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  async trackUsage(data: AIUsageDataSchema): Promise<{ id: string }> {
    try {
      const result = await this.getPool().query(
        `INSERT INTO ai.usage (config_id, input_tokens, output_tokens, image_count, image_resolution)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          data.configId,
          data.inputTokens || null,
          data.outputTokens || null,
          data.imageCount || null,
          data.imageResolution || null,
        ]
      );

      logger.info('AI usage tracked', {
        id: result.rows[0].id,
        configId: data.configId,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        imageCount: data.imageCount,
      });

      return { id: result.rows[0].id };
    } catch (error) {
      logger.error('Failed to track AI usage', { error, data });
      throw new Error('Failed to track AI usage');
    }
  }

  async trackChatUsage(
    configId: string,
    inputTokens?: number,
    outputTokens?: number,
    modelId?: string
  ): Promise<{ id: string }> {
    const totalTokens = (inputTokens || 0) + (outputTokens || 0);

    try {
      const usageResult = await this.getPool().query(
        `INSERT INTO ai.usage (config_id, input_tokens, output_tokens, model_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [configId, inputTokens || null, outputTokens || null, modelId || null]
      );

      logger.debug('Chat usage tracked', {
        id: usageResult.rows[0].id,
        configId,
        inputTokens,
        outputTokens,
        totalTokens,
        modelId,
      });

      return { id: usageResult.rows[0].id };
    } catch (error) {
      logger.error('Failed to track chat usage', { error, configId });
      throw new Error('Failed to track chat usage');
    }
  }

  async trackEmbeddingUsage(
    configId: string,
    inputTokens?: number,
    totalTokens?: number,
    modelId?: string
  ): Promise<{ id: string }> {
    const outputTokens = Math.max(0, (totalTokens || 0) - (inputTokens || 0));
    try {
      const usageResult = await this.getPool().query(
        `INSERT INTO ai.usage (config_id, input_tokens, output_tokens, model_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [configId, inputTokens || null, outputTokens || null, modelId || null]
      );

      logger.debug('Embedding usage tracked', {
        id: usageResult.rows[0].id,
        configId,
        inputTokens,
        outputTokens,
        totalTokens,
        modelId,
      });

      return { id: usageResult.rows[0].id };
    } catch (error) {
      logger.error('Failed to track embedding usage', { error, configId });
      throw new Error('Failed to track embedding usage');
    }
  }

  async trackImageGenerationUsage(
    configId: string,
    imageCount: number,
    imageResolution?: string,
    inputTokens?: number,
    outputTokens?: number,
    modelId?: string
  ): Promise<{ id: string }> {
    try {
      const usageResult = await this.getPool().query(
        `INSERT INTO ai.usage (config_id, image_count, image_resolution, input_tokens, output_tokens, model_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          configId,
          imageCount,
          imageResolution || null,
          inputTokens || null,
          outputTokens || null,
          modelId || null,
        ]
      );

      logger.debug('Image usage tracked', {
        id: usageResult.rows[0].id,
        configId,
        imageCount,
        imageResolution,
        inputTokens,
        outputTokens,
        modelId,
      });

      return { id: usageResult.rows[0].id };
    } catch (error) {
      logger.error('Failed to track image usage', { error, configId });
      throw new Error('Failed to track image usage');
    }
  }

  async getUsageByConfig(
    configId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<AIUsageRecordSchema[]> {
    try {
      let query = `
        SELECT id, config_id as "configId", input_tokens as "inputTokens",
               output_tokens as "outputTokens", image_count as "imageCount",
               image_resolution as "imageResolution", created_at as "createdAt"
        FROM ai.usage
        WHERE config_id = $1
      `;

      const params: (string | Date)[] = [configId];

      if (startDate) {
        params.push(startDate);
        query += ` AND created_at >= $${params.length}`;
      }

      if (endDate) {
        params.push(endDate);
        query += ` AND created_at <= $${params.length}`;
      }

      query += ' ORDER BY created_at DESC';

      const result = await this.getPool().query(query, params);

      return result.rows;
    } catch (error) {
      logger.error('Failed to fetch usage by config', { error, configId });
      throw new Error('Failed to fetch usage records');
    }
  }

  async getUsageSummary(
    configId?: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<AIUsageSummarySchema> {
    try {
      let query = `
        SELECT
          COALESCE(SUM(input_tokens), 0) as "totalInputTokens",
          COALESCE(SUM(output_tokens), 0) as "totalOutputTokens",
          COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) as "totalTokens",
          COALESCE(SUM(image_count), 0) as "totalImageCount",
          COUNT(*) as "totalRequests"
        FROM ai.usage
        WHERE 1=1
      `;

      const params: (string | Date)[] = [];

      if (configId) {
        params.push(configId);
        query += ` AND config_id = $${params.length}`;
      }

      if (startDate) {
        params.push(startDate);
        query += ` AND created_at >= $${params.length}`;
      }

      if (endDate) {
        params.push(endDate);
        query += ` AND created_at <= $${params.length}`;
      }

      const result = await this.getPool().query(query, params);

      return {
        totalInputTokens: parseInt(result.rows[0].totalInputTokens),
        totalOutputTokens: parseInt(result.rows[0].totalOutputTokens),
        totalTokens: parseInt(result.rows[0].totalTokens),
        totalImageCount: parseInt(result.rows[0].totalImageCount),
        totalRequests: parseInt(result.rows[0].totalRequests),
      };
    } catch (error) {
      logger.error('Failed to fetch usage summary', { error, configId });
      throw new Error('Failed to fetch usage summary');
    }
  }

  async getAllUsage(
    startDate?: Date,
    endDate?: Date,
    limit?: number,
    offset?: number
  ): Promise<ListAIUsageResponse> {
    try {
      let query = `
        SELECT
          u.id,
          u.config_id as "configId",
          u.input_tokens as "inputTokens",
          u.output_tokens as "outputTokens",
          u.image_count as "imageCount",
          u.image_resolution as "imageResolution",
          u.created_at as "createdAt",
          u.model_id as "modelId",
          COALESCE(u.model_id, c.model_id) as "model",
          c.provider,
          c.input_modality as "inputModality",
          c.output_modality as "outputModality"
        FROM ai.usage u
        LEFT JOIN ai.configs c ON u.config_id = c.id
        WHERE 1=1
      `;

      const params: (string | Date | number)[] = [];

      if (startDate) {
        params.push(startDate);
        query += ` AND u.created_at >= $${params.length}`;
      }

      if (endDate) {
        params.push(endDate);
        query += ` AND u.created_at <= $${params.length}`;
      }

      const countQuery = `SELECT COUNT(*) as total FROM (${query}) as subquery`;
      const countResult = await this.getPool().query(countQuery, params);

      query += ' ORDER BY u.created_at DESC';

      if (limit) {
        params.push(limit);
        query += ` LIMIT $${params.length}`;
      }

      if (offset) {
        params.push(offset);
        query += ` OFFSET $${params.length}`;
      }

      const result = await this.getPool().query(query, params);

      return {
        records: result.rows,
        total: parseInt(countResult.rows[0].total),
      };
    } catch (error) {
      logger.error('Failed to fetch all usage records', { error });
      throw new Error('Failed to fetch usage records');
    }
  }
}
