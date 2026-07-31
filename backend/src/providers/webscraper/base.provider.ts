import { z } from 'zod';

// The Apify connection response is small and Apify-specific, so its schema lives
// here rather than in @insforge/shared-schemas. Shared by both providers so the
// cloud proxy and the local direct client cannot drift apart.
export const apifyConnectionSchema = z.object({
  apifyUsername: z.string().nullable(),
  plan: z.string().nullable(),
  planTier: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  dataRetentionDays: z.number().nullable().optional(),
  status: z.enum(['active', 'degraded', 'revoked']),
  createdAt: z.string(),
});
export type ApifyConnection = z.infer<typeof apifyConnectionSchema>;

// Implemented twice: CloudWebscraperProvider proxies to cloud-backend, LocalWebscraperProvider
// calls api.apify.com directly with a developer-supplied token. `null` means
// "not connected" and the routes turn it into 404 not_connected.
export interface WebscraperProvider {
  getConnection(): Promise<ApifyConnection | null>;
  disconnect(): Promise<void>;
  getToken(): Promise<{ accessToken: string } | null>;
  getRuns(limit: number): Promise<{ runs: unknown[] } | null>;
  getActors(limit: number): Promise<{ actors: unknown[] } | null>;
  getDatasets(limit: number): Promise<{ datasets: unknown[] } | null>;
  getLatestData(limit: number): Promise<{ datasetId: string | null; items: unknown[] } | null>;
}
