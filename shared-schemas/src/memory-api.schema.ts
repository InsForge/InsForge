import { z } from 'zod';
import {
  conversationSchema,
  conversationWithMessagesSchema,
  conversationSearchResultSchema,
  messageSearchResultSchema,
} from './memory.schema';

/**
 * Schema for a message input when storing a conversation.
 */
export const messageInputSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().min(1, 'Message content cannot be empty'),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Schema for storing a new conversation with messages.
 */
export const storeConversationRequestSchema = z.object({
  title: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  messages: z
    .array(messageInputSchema)
    .min(1, 'At least one message is required'),
  embeddingModel: z
    .string()
    .optional()
    .describe('Embedding model to use. Uses project AI config default if not specified.'),
});

/**
 * Schema for searching conversations by semantic similarity.
 */
export const searchConversationsRequestSchema = z.object({
  query: z.string().min(1, 'Search query cannot be empty'),
  limit: z.number().int().positive().max(100).default(10).optional(),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .default(0)
    .optional()
    .describe('Minimum similarity threshold (0-1)'),
  metadataFilter: z
    .record(z.unknown())
    .optional()
    .describe('Filter conversations by metadata (uses JSONB containment)'),
  embeddingModel: z
    .string()
    .optional()
    .describe('Embedding model to use for the search query'),
});

/**
 * Schema for searching messages by semantic similarity.
 */
export const searchMessagesRequestSchema = z.object({
  query: z.string().min(1, 'Search query cannot be empty'),
  conversationId: z
    .string()
    .uuid()
    .optional()
    .describe('Limit search to a specific conversation'),
  limit: z.number().int().positive().max(100).default(10).optional(),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .default(0)
    .optional()
    .describe('Minimum similarity threshold (0-1)'),
  embeddingModel: z
    .string()
    .optional()
    .describe('Embedding model to use for the search query'),
});

/**
 * Response schema for storing a conversation.
 */
export const storeConversationResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  messageCount: z.number().int(),
  message: z.string(),
});

/**
 * Response schema for getting a conversation with messages.
 */
export const getConversationResponseSchema = conversationWithMessagesSchema;

/**
 * Response schema for searching conversations.
 */
export const searchConversationsResponseSchema = z.array(conversationSearchResultSchema);

/**
 * Response schema for searching messages.
 */
export const searchMessagesResponseSchema = z.array(messageSearchResultSchema);

/**
 * Response schema for deleting a conversation.
 */
export const deleteConversationResponseSchema = z.object({
  message: z.string(),
});

export type MessageInput = z.infer<typeof messageInputSchema>;
export type StoreConversationRequest = z.infer<typeof storeConversationRequestSchema>;
export type SearchConversationsRequest = z.infer<typeof searchConversationsRequestSchema>;
export type SearchMessagesRequest = z.infer<typeof searchMessagesRequestSchema>;
export type StoreConversationResponse = z.infer<typeof storeConversationResponseSchema>;
export type GetConversationResponse = z.infer<typeof getConversationResponseSchema>;
export type SearchConversationsResponse = z.infer<typeof searchConversationsResponseSchema>;
export type SearchMessagesResponse = z.infer<typeof searchMessagesResponseSchema>;
export type DeleteConversationResponse = z.infer<typeof deleteConversationResponseSchema>;
