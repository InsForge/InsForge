import { z } from 'zod';

// How a plugin gets installed. 'secret' is the only supported type today:
// validate the user's API key against the provider, then store it as an
// encrypted project secret (auto-injected into edge-function environments).
export const marketplaceInstallSpecSchema = z.object({
  type: z.literal('secret'),
  secretName: z
    .string()
    .regex(/^[A-Z0-9_]+$/, 'Use uppercase letters, numbers, and underscores only'),
  placeholder: z.string(),
  validation: z
    .object({
      url: z.string().url().startsWith('https://', 'Validation URL must use https'),
      method: z.enum(['GET', 'POST']).optional(),
    })
    .optional(),
});

export const marketplacePluginSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  publisher: z.string(),
  category: z.string(),
  description: z.string(),
  // Honest list of what installing actually does, shown in the install dialog
  actions: z.array(z.string()),
  // Provider icon image; the dashboard falls back to a letter avatar when
  // absent or unloadable
  iconUrl: z.string().url().optional(),
  install: marketplaceInstallSpecSchema,
  docsUrl: z.string().url().optional(),
  skillUrl: z.string().url().optional(),
});

// Shape of the remotely-hosted marketplace.json (S3/CDN, provisioned by
// insforge-cloudbackend). The backend validates fetched content against this
// schema and falls back to its bundled catalog when it doesn't conform.
export const marketplaceCatalogSchema = z.object({
  version: z.number().int().nonnegative(),
  plugins: z.array(marketplacePluginSchema),
});

export type MarketplaceInstallSpec = z.infer<typeof marketplaceInstallSpecSchema>;
export type MarketplacePlugin = z.infer<typeof marketplacePluginSchema>;
export type MarketplaceCatalog = z.infer<typeof marketplaceCatalogSchema>;
