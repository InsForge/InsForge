import { z } from 'zod';
import {
  posthogConnectionSchema,
  posthogConnectionStatusSchema,
  posthogDashboardsResponseSchema,
} from './posthog.schema.js';

// Connection management request/response schemas

export const createPosthogConnectionRequestSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  region: z.enum(['US', 'EU']),
  host: z.string().url().optional(),
});
export type CreatePosthogConnectionRequest = z.infer<typeof createPosthogConnectionRequestSchema>;

export const createPosthogConnectionResponseSchema = posthogConnectionSchema.extend({
  message: z.string(),
});
export type CreatePosthogConnectionResponse = z.infer<typeof createPosthogConnectionResponseSchema>;

export const getPosthogConnectionResponseSchema = posthogConnectionSchema;
export type GetPosthogConnectionResponse = z.infer<typeof getPosthogConnectionResponseSchema>;

export const updatePosthogConnectionStatusRequestSchema = z.object({
  status: posthogConnectionStatusSchema,
});
export type UpdatePosthogConnectionStatusRequest = z.infer<
  typeof updatePosthogConnectionStatusRequestSchema
>;

export const deletePosthogConnectionResponseSchema = z.object({
  message: z.string(),
});
export type DeletePosthogConnectionResponse = z.infer<typeof deletePosthogConnectionResponseSchema>;

// Dashboard listing response schema

export const getPosthogDashboardsResponseSchema = posthogDashboardsResponseSchema;
export type GetPosthogDashboardsResponse = z.infer<typeof getPosthogDashboardsResponseSchema>;
