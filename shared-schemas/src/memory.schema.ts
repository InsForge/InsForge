import { z } from 'zod';

/**
 * Schema for a single message within a conversation (stored as JSONB).
 */
export const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  position: z.number().int().nonnegative(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
});

/**
 * Schema for a conversation.
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
  messages: z.array(messageSchema),
});

/**
 * Schema for a conversation search result with similarity score.
 */
export const conversationSearchResultSchema = conversationSchema.omit({ userId: true }).extend({
  similarity: z.number().min(0).max(1),
});

export type MessageSchema = z.infer<typeof messageSchema>;
export type ConversationSchema = z.infer<typeof conversationSchema>;
export type ConversationWithMessagesSchema = z.infer<typeof conversationWithMessagesSchema>;
export type ConversationSearchResultSchema = z.infer<typeof conversationSearchResultSchema>;
