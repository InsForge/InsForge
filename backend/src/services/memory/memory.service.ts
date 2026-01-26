import { DatabaseManager } from '@/infra/database/database.manager.js';
import logger from '@/utils/logger.js';
import { EmbeddingService } from '@/services/ai/embedding.service.js';
import { ERROR_CODES } from '@/types/error-constants';
import { AppError } from '@/api/middlewares/error.js';
import {
  type StoreConversationRequest,
  type SearchConversationsRequest,
  type ConversationWithMessagesSchema,
  type ConversationSearchResultSchema,
} from '@insforge/shared-schemas';
import { randomUUID } from 'crypto';

// Default embedding model - OpenAI's small model is fast and cost-effective
const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small';

export class MemoryService {
  private static instance: MemoryService;
  private dbManager: DatabaseManager;
  private embeddingService: EmbeddingService;

  private constructor() {
    this.dbManager = DatabaseManager.getInstance();
    this.embeddingService = EmbeddingService.getInstance();
  }

  public static getInstance(): MemoryService {
    if (!MemoryService.instance) {
      MemoryService.instance = new MemoryService();
    }
    return MemoryService.instance;
  }

  /**
   * Get the embedding model - uses requested model or falls back to default.
   */
  private getEmbeddingModel(requestedModel?: string): string {
    return requestedModel || DEFAULT_EMBEDDING_MODEL;
  }

  /**
   * Generate embeddings for text content.
   */
  private async generateEmbedding(text: string, model: string): Promise<number[]> {
    const response = await this.embeddingService.createEmbeddings({
      model,
      input: text,
      encoding_format: 'float',
    });

    if (response.data.length === 0) {
      throw new AppError('Failed to generate embedding', 500, ERROR_CODES.INTERNAL_ERROR);
    }

    const embedding = response.data[0].embedding;
    if (typeof embedding === 'string') {
      throw new AppError(
        'Expected float embedding but got base64',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    return embedding;
  }

  /**
   * Generate a summary of a conversation for embedding.
   */
  private generateConversationSummary(
    messages: Array<{ role: string; content: string }>,
    title?: string
  ): string {
    const parts: string[] = [];

    if (title) {
      parts.push(`Title: ${title}`);
    }

    // Include a condensed version of messages for summary embedding
    const messageSummaries = messages.slice(0, 10).map((m) => {
      const truncatedContent =
        m.content.length > 200 ? m.content.substring(0, 200) + '...' : m.content;
      return `${m.role}: ${truncatedContent}`;
    });

    parts.push(...messageSummaries);

    if (messages.length > 10) {
      parts.push(`... and ${messages.length - 10} more messages`);
    }

    return parts.join('\n');
  }

  /**
   * Store a new conversation with messages and generate summary embedding.
   * Messages are stored as JSONB - only the summary is embedded.
   */
  async storeConversation(
    userId: string,
    data: StoreConversationRequest
  ): Promise<{ id: string; title: string | null; messageCount: number }> {
    try {
      const embeddingModel = this.getEmbeddingModel(data.embeddingModel);
      const conversationId = randomUUID();

      // Generate conversation summary embedding (only 1 embedding call)
      const summaryText = this.generateConversationSummary(data.messages, data.title);
      const summaryEmbedding = await this.generateEmbedding(summaryText, embeddingModel);

      // Prepare messages as JSONB
      const messagesJson = data.messages.map((msg, index) => ({
        role: msg.role,
        content: msg.content,
        position: index,
        metadata: msg.metadata || {},
      }));

      const sql = `
        INSERT INTO public.memory_conversations (
          id, user_id, title, messages, metadata, summary_embedding, summary_text, message_count
        ) VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8)
        RETURNING id, title, message_count AS "messageCount"
      `;

      const result = await this.dbManager
        .getPool()
        .query(sql, [
          conversationId,
          userId,
          data.title || null,
          JSON.stringify(messagesJson),
          JSON.stringify(data.metadata || {}),
          JSON.stringify(summaryEmbedding),
          summaryText,
          data.messages.length,
        ]);

      logger.info('Stored conversation', {
        conversationId,
        userId,
        messageCount: data.messages.length,
      });

      return {
        id: result.rows[0].id,
        title: result.rows[0].title,
        messageCount: result.rows[0].messageCount,
      };
    } catch (error) {
      logger.error('Error storing conversation', { error, userId });
      throw error;
    }
  }

  /**
   * Search conversations by semantic similarity.
   */
  async searchConversations(
    userId: string,
    data: SearchConversationsRequest
  ): Promise<ConversationSearchResultSchema[]> {
    try {
      const embeddingModel = this.getEmbeddingModel(data.embeddingModel);
      const queryEmbedding = await this.generateEmbedding(data.query, embeddingModel);

      const sql = `
        SELECT * FROM public.search_memory_conversations(
          $1, $2::vector, $3, $4, $5
        )
      `;

      const result = await this.dbManager
        .getPool()
        .query(sql, [
          userId,
          JSON.stringify(queryEmbedding),
          data.limit || 10,
          data.threshold || 0,
          data.metadataFilter ? JSON.stringify(data.metadataFilter) : null,
        ]);

      const conversations = result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        metadata: row.metadata,
        summaryText: row.summary_text,
        messageCount: row.message_count,
        similarity: row.similarity,
        createdAt: this.toISOString(row.created_at),
        updatedAt: this.toISOString(row.updated_at),
      }));

      logger.info('Conversation search completed', {
        userId,
        resultCount: conversations.length,
        query: data.query.substring(0, 50),
      });

      return conversations;
    } catch (error) {
      logger.error('Error searching conversations', { error, userId });
      throw error;
    }
  }

  /**
   * Get a conversation with all its messages.
   */
  async getConversation(
    userId: string,
    conversationId: string
  ): Promise<ConversationWithMessagesSchema | null> {
    try {
      const sql = `SELECT * FROM public.get_memory_conversation($1, $2)`;

      const result = await this.dbManager.getPool().query(sql, [userId, conversationId]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];

      return {
        id: row.id,
        userId: row.user_id,
        title: row.title,
        metadata: row.metadata,
        summaryText: row.summary_text,
        messageCount: row.message_count,
        createdAt: this.toISOString(row.created_at),
        updatedAt: this.toISOString(row.updated_at),
        messages: (row.messages || []).map(
          (m: {
            role: string;
            content: string;
            position: number;
            metadata: Record<string, unknown>;
          }) => ({
            id: `${row.id}-${m.position}`, // Generate ID from conversation + position
            role: m.role as 'user' | 'assistant' | 'system' | 'tool',
            content: m.content,
            position: m.position,
            metadata: m.metadata,
            createdAt: this.toISOString(row.created_at), // Use conversation timestamp
          })
        ),
      };
    } catch (error) {
      logger.error('Error getting conversation', { error, userId, conversationId });
      throw error;
    }
  }

  /**
   * Delete a conversation.
   */
  async deleteConversation(userId: string, conversationId: string): Promise<void> {
    try {
      const sql = `
        DELETE FROM public.memory_conversations
        WHERE id = $1 AND user_id = $2
      `;

      const result = await this.dbManager.getPool().query(sql, [conversationId, userId]);

      if (result.rowCount === 0) {
        throw new AppError('Conversation not found', 404, ERROR_CODES.NOT_FOUND);
      }

      logger.info('Deleted conversation', { conversationId, userId });
    } catch (error) {
      logger.error('Error deleting conversation', { error, userId, conversationId });
      throw error;
    }
  }

  /**
   * Convert date to ISO string safely.
   */
  private toISOString(date: unknown): string {
    if (!date) {
      return '';
    }
    if (date instanceof Date) {
      return date.toISOString();
    }
    if (typeof date === 'string') {
      return date;
    }
    return String(date);
  }
}
