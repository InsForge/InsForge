// Backend-only types for deployments

/**
 * Deployment status constants
 * WAITING -> UPLOADING -> (Vercel statuses: QUEUED/BUILDING/READY/ERROR/CANCELED)
 */
export const DeploymentStatus = {
  // InsForge internal statuses
  WAITING: 'WAITING', // Record created, waiting for source zip upload or direct file registration/content
  UPLOADING: 'UPLOADING', // File uploads or Vercel deployment creation are in progress
  // Vercel statuses (stored directly)
  QUEUED: 'QUEUED',
  BUILDING: 'BUILDING',
  READY: 'READY',
  ERROR: 'ERROR',
  CANCELED: 'CANCELED',
} as const;

export type DeploymentStatusType = (typeof DeploymentStatus)[keyof typeof DeploymentStatus];

/**
 * Internal deployment record with Date objects (database returns Date, not string)
 */
export interface DeploymentRecord {
  id: string;
  providerDeploymentId: string | null; // Provider's deployment ID, null until deployment starts
  provider: string;
  status: DeploymentStatusType;
  url: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}
