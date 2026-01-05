// Webhook types for external integrations

// ============================================================================
// Vercel Webhooks
// ============================================================================

/**
 * Vercel webhook event types we handle for deployments
 */
export type VercelDeploymentEventType =
  | 'deployment.created'
  | 'deployment.succeeded'
  | 'deployment.error'
  | 'deployment.canceled';

/**
 * Map Vercel webhook event types to our deployment status
 */
export const VERCEL_EVENT_TO_STATUS: Record<VercelDeploymentEventType, string> = {
  'deployment.created': 'BUILDING',
  'deployment.succeeded': 'READY',
  'deployment.error': 'ERROR',
  'deployment.canceled': 'CANCELED',
};

/**
 * Vercel webhook payload structure for deployment events
 */
export interface VercelWebhookPayload {
  type: string;
  id: string;
  createdAt: string;
  payload: {
    team?: { id: string };
    user?: { id: string };
    deployment: {
      id: string;
      url: string;
      name: string;
      meta?: Record<string, unknown>;
    };
    target?: string;
    project?: { id: string };
  };
}
