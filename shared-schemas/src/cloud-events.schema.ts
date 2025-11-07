import { z } from 'zod';

export const appRouteChangeEventSchema = z.object({
  type: z.literal('APP_ROUTE_CHANGE'),
  path: z.string(),
});

export const authSuccessEventSchema = z.object({
  type: z.literal('AUTH_SUCCESS'),
});

export const authErrorEventSchema = z.object({
  type: z.literal('AUTH_ERROR'),
  message: z.string(),
});

export const mcpConnectionStatusEventSchema = z.object({
  type: z.literal('MCP_CONNECTION_STATUS'),
  connected: z.boolean(),
  toolName: z.string(),
  timestamp: z.union([z.number(), z.string()]),
});

export const showConnectOverlayEventSchema = z.object({
  type: z.literal('SHOW_CONNECT_OVERLAY'),
});

export const showSettingsOverlayEventSchema = z.object({
  type: z.literal('SHOW_SETTINGS_OVERLAY'),
});

export const cloudEventSchema = z.discriminatedUnion('type', [
  appRouteChangeEventSchema,
  authSuccessEventSchema,
  authErrorEventSchema,
  mcpConnectionStatusEventSchema,
  showConnectOverlayEventSchema,
  showSettingsOverlayEventSchema,
]);

export type AppRouteChangeEvent = z.infer<typeof appRouteChangeEventSchema>;
export type AuthSuccessEvent = z.infer<typeof authSuccessEventSchema>;
export type AuthErrorEvent = z.infer<typeof authErrorEventSchema>;
export type McpConnectionStatusEvent = z.infer<typeof mcpConnectionStatusEventSchema>;
export type CloudEvent = z.infer<typeof cloudEventSchema>;
export type ShowConnectOverlayEvent = z.infer<typeof showConnectOverlayEventSchema>;
export type ShowSettingsOverlayEvent = z.infer<typeof showSettingsOverlayEventSchema>;
