import { z } from 'zod';

/**
 * Schema for a single message within a conversation.
 * Used for both input and database representation.
 */
export const messageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  position: z.number().int().nonnegative(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
});

/**
 * Schema for a conversation with optional messages.
 * Properties are camelCased to align with TypeScript conventions.
 */
export const conversationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  title: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  summaryText: z.string().nullable(),
  messageCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/**
 * Schema for a conversation with its messages included.
 */
export const conversationWithMessagesSchema = conversationSchema.extend({
  messages: z.array(messageSchema.omit({ conversationId: true })),
});

/**
 * Schema for a search result with similarity score.
 */
export const conversationSearchResultSchema = conversationSchema
  .omit({ userId: true })
  .extend({
    similarity: z.number().min(0).max(1),
  });

/**
 * Schema for a message search result with similarity score and conversation context.
 */
export const messageSearchResultSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  conversationTitle: z.string().nullable(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  position: z.number().int().nonnegative(),
  metadata: z.record(z.unknown()).nullable(),
  similarity: z.number().min(0).max(1),
  createdAt: z.string().datetime(),
});

export type MessageSchema = z.infer<typeof messageSchema>;
export type ConversationSchema = z.infer<typeof conversationSchema>;
export type ConversationWithMessagesSchema = z.infer<typeof conversationWithMessagesSchema>;
export type ConversationSearchResultSchema = z.infer<typeof conversationSearchResultSchema>;
export type MessageSearchResultSchema = z.infer<typeof messageSearchResultSchema>;
