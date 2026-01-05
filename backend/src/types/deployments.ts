// Backend-only types for deployments

/**
 * Internal deployment record with Date objects (database returns Date, not string)
 */
export interface DeploymentRecord {
  id: string;
  deploymentId: string;
  provider: string;
  status: string;
  url: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}
