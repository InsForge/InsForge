import { z } from 'zod';

export const deploymentSchema = z.object({
  id: z.string().uuid(),
  deploymentId: z.string(),
  provider: z.string(),
  status: z.string(),
  url: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type DeploymentSchema = z.infer<typeof deploymentSchema>;
