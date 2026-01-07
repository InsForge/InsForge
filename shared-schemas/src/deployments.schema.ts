import { z } from 'zod';

/**
 * Deployment status enum schema
 * WAITING -> UPLOADING -> (Vercel statuses: QUEUED/BUILDING/READY/ERROR/CANCELED)
 */
export const deploymentStatusSchema = z.enum([
  'WAITING', // Record created, waiting for client to upload zip to S3
  'UPLOADING', // Server is downloading from S3 and uploading to Vercel
  'QUEUED', // Vercel: deployment queued
  'BUILDING', // Vercel: deployment building
  'READY', // Vercel: deployment ready
  'ERROR', // Vercel: deployment failed
  'CANCELED', // Vercel: deployment canceled
]);

export type DeploymentStatusType = z.infer<typeof deploymentStatusSchema>;

export const deploymentSchema = z.object({
  id: z.string().uuid(),
  providerDeploymentId: z.string().nullable(), // Provider's deployment ID, null until deployment starts
  provider: z.string(),
  status: deploymentStatusSchema,
  url: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type DeploymentSchema = z.infer<typeof deploymentSchema>;
