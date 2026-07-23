import { z } from 'zod';
import { marketplacePluginSchema } from './marketplace.schema.js';

export const marketplacePluginWithStatusSchema = marketplacePluginSchema.extend({
  installed: z.boolean(),
});

// GET /marketplace/plugins
export const listMarketplacePluginsResponseSchema = z.object({
  plugins: z.array(marketplacePluginWithStatusSchema),
});

// POST /marketplace/plugins/:slug/install
export const installMarketplacePluginRequestSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
});

export const installMarketplacePluginResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});

// DELETE /marketplace/plugins/:slug
export const uninstallMarketplacePluginResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});

export type MarketplacePluginWithStatus = z.infer<typeof marketplacePluginWithStatusSchema>;
export type ListMarketplacePluginsResponse = z.infer<typeof listMarketplacePluginsResponseSchema>;
export type InstallMarketplacePluginRequest = z.infer<typeof installMarketplacePluginRequestSchema>;
export type InstallMarketplacePluginResponse = z.infer<
  typeof installMarketplacePluginResponseSchema
>;
export type UninstallMarketplacePluginResponse = z.infer<
  typeof uninstallMarketplacePluginResponseSchema
>;
