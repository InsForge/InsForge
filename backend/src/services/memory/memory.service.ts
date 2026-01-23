import { DatabaseManager } from '@/infra/database/database.manager.js';
import logger from '@/utils/logger.js';
import { EmbeddingService } from '@/services/ai/embedding.service.js';
import { ERROR_CODES } from '@/types/error-constants';
import { AppError } from '@/api/middlewares/error.js';
import {
  type StoreConversationRequest,
  type SearchConversationsRequest,
  type SearchMessagesRequest,
  type ConversationWithMessagesSchema,
  type ConversationSearchResultSchema,
  type MessageSearchResultSchema,
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
   * Store a new conversation with messages and generate embeddings.
   */
  async storeConversation(
    userId: string,
    data: StoreConversationRequest
  ): Promise<{ id: string; title: string | null; messageCount: number }> {
    const client = await this.dbManager.getPool().connect();

    try {
      await client.query('BEGIN');

      const embeddingModel = await this.getEmbeddingModel(data.embeddingModel);
      const conversationId = randomUUID();

      // Generate conversation summary embedding
      const summaryText = this.generateConversationSummary(data.messages, data.title);
      const summaryEmbedding = await this.generateEmbedding(summaryText, embeddingModel);

      // Insert conversation
      const insertConversationSql = `
        INSERT INTO memory.conversations (
          id, user_id, title, metadata, summary_embedding, summary_text, message_count
        ) VALUES ($1, $2, $3, $4, $5::vector, $6, $7)
        RETURNING id, title, message_count AS "messageCount"
      `;

      const conversationResult = await client.query(insertConversationSql, [
        conversationId,
        userId,
        data.title || null,
        JSON.stringify(data.metadata || {}),
        JSON.stringify(summaryEmbedding),
        summaryText,
        data.messages.length,
      ]);

      // Generate embeddings for each message and insert
      for (let i = 0; i < data.messages.length; i++) {
        const msg = data.messages[i];
        const messageId = randomUUID();
        const messageEmbedding = await this.generateEmbedding(msg.content, embeddingModel);

        const insertMessageSql = `
          INSERT INTO memory.messages (
            id, conversation_id, role, content, embedding, position, metadata
          ) VALUES ($1, $2, $3, $4, $5::vector, $6, $7)
        `;

        await client.query(insertMessageSql, [
          messageId,
          conversationId,
          msg.role,
          msg.content,
          JSON.stringify(messageEmbedding),
          i,
          JSON.stringify(msg.metadata || {}),
        ]);
      }

      await client.query('COMMIT');

      logger.info('Stored conversation with messages', {
        conversationId,
        userId,
        messageCount: data.messages.length,
      });

      return {
        id: conversationResult.rows[0].id,
        title: conversationResult.rows[0].title,
        messageCount: conversationResult.rows[0].messageCount,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error storing conversation', { error, userId });
      throw error;
    } finally {
      client.release();
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
      const embeddingModel = await this.getEmbeddingModel(data.embeddingModel);
      const queryEmbedding = await this.generateEmbedding(data.query, embeddingModel);

      const sql = `
        SELECT * FROM memory.search_conversations(
          $1, $2::vector, $3, $4, $5
        )
      `;

      const result = await this.dbManager.getPool().query(sql, [
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
   * Search messages by semantic similarity.
   */
  async searchMessages(
    userId: string,
    data: SearchMessagesRequest
  ): Promise<MessageSearchResultSchema[]> {
    try {
      const embeddingModel = await this.getEmbeddingModel(data.embeddingModel);
      const queryEmbedding = await this.generateEmbedding(data.query, embeddingModel);

      const sql = `
        SELECT * FROM memory.search_messages(
          $1, $2::vector, $3, $4, $5
        )
      `;

      const result = await this.dbManager.getPool().query(sql, [
        userId,
        JSON.stringify(queryEmbedding),
        data.conversationId || null,
        data.limit || 10,
        data.threshold || 0,
      ]);

      const messages = result.rows.map((row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        conversationTitle: row.conversation_title,
        role: row.role as 'user' | 'assistant' | 'system' | 'tool',
        content: row.content,
        position: row.position,
        metadata: row.metadata,
        similarity: row.similarity,
        createdAt: this.toISOString(row.created_at),
      }));

      logger.info('Message search completed', {
        userId,
        resultCount: messages.length,
        conversationId: data.conversationId,
        query: data.query.substring(0, 50),
      });

      return messages;
    } catch (error) {
      logger.error('Error searching messages', { error, userId });
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
      const sql = `SELECT * FROM memory.get_conversation_with_messages($1, $2)`;

      const result = await this.dbManager.getPool().query(sql, [userId, conversationId]);

      if (result.rows.length === 0 || !result.rows[0].conversation) {
        return null;
      }

      const conv = result.rows[0].conversation;

      return {
        id: conv.id,
        userId: conv.userId,
        title: conv.title,
        metadata: conv.metadata,
        summaryText: conv.summaryText,
        messageCount: conv.messageCount,
        createdAt: this.toISOString(conv.createdAt),
        updatedAt: this.toISOString(conv.updatedAt),
        messages: (conv.messages || []).map(
          (m: {
            id: string;
            role: string;
            content: string;
            position: number;
            metadata: Record<string, unknown>;
            createdAt: string | Date;
          }) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant' | 'system' | 'tool',
            content: m.content,
            position: m.position,
            metadata: m.metadata,
            createdAt: this.toISOString(m.createdAt),
          })
        ),
      };
    } catch (error) {
      logger.error('Error getting conversation', { error, userId, conversationId });
      throw error;
    }
  }

  /**
   * Delete a conversation and all its messages.
   */
  async deleteConversation(userId: string, conversationId: string): Promise<void> {
    try {
      const sql = `
        DELETE FROM memory.conversations
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
