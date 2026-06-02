import type {
  RazorpayConnection,
  RazorpayEnvironment,
  RazorpayKeyConfig,
} from '@insforge/shared-schemas';
import { apiClient } from '#lib/api/client';

export interface GetRazorpayStatusResponse {
  razorpayConnections: RazorpayConnection[];
}

export interface GetRazorpayConfigResponse {
  razorpayKeys: RazorpayKeyConfig[];
}

export interface UpsertRazorpayConfigRequest {
  environment: RazorpayEnvironment;
  keyId: string;
  keySecret: string;
  webhookSecret?: string;
}

export interface ConfigureRazorpayWebhookResponse {
  connection: RazorpayConnection;
}

export interface SyncRazorpayPaymentsRequest {
  environment: RazorpayEnvironment | 'all';
}

export interface SyncRazorpayPaymentsResponse {
  connection: RazorpayConnection;
  syncCounts: {
    plans: number;
    items: number;
    customers: number;
    subscriptions: number;
    payments: number;
  };
}

export interface SyncRazorpayPaymentsMultiResponse {
  results: {
    environment: RazorpayEnvironment;
    status: 'fulfilled' | 'rejected';
    value?: SyncRazorpayPaymentsResponse;
    reason?: any;
  }[];
}

export class RazorpayService {
  async getStatus(): Promise<GetRazorpayStatusResponse> {
    return apiClient.request('/payments/razorpay/status', {
      headers: apiClient.withAccessToken(),
    });
  }

  async getConfig(): Promise<GetRazorpayConfigResponse> {
    return apiClient.request('/payments/razorpay/config', {
      headers: apiClient.withAccessToken(),
    });
  }

  async upsertConfig(input: UpsertRazorpayConfigRequest): Promise<GetRazorpayConfigResponse> {
    const body: Record<string, string> = { keyId: input.keyId, keySecret: input.keySecret };
    if (input.webhookSecret) {
      body.webhookSecret = input.webhookSecret;
    }
    return apiClient.request(`/payments/razorpay/${input.environment}/config`, {
      method: 'PUT',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(body),
    });
  }

  async removeConfig(environment: RazorpayEnvironment): Promise<GetRazorpayConfigResponse> {
    return apiClient.request(`/payments/razorpay/${environment}/config`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }

  async configureWebhook(
    environment: RazorpayEnvironment
  ): Promise<ConfigureRazorpayWebhookResponse> {
    return apiClient.request(`/payments/razorpay/${environment}/webhook-configure`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
    });
  }

  async syncPayments(
    input: SyncRazorpayPaymentsRequest
  ): Promise<SyncRazorpayPaymentsResponse | SyncRazorpayPaymentsMultiResponse> {
    if (input.environment === 'all') {
      const environments: RazorpayEnvironment[] = ['test', 'live'];
      const results = await Promise.allSettled(
        environments.map((env) => this.syncPayments({ environment: env }))
      );

      return {
        results: results.map((r, i) => ({
          environment: environments[i],
          status: r.status,
          ...(r.status === 'fulfilled'
            ? { value: r.value as SyncRazorpayPaymentsResponse }
            : { reason: r.reason }),
        })),
      };
    }

    return apiClient.request(`/payments/razorpay/${input.environment}/sync`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
    });
  }
}

export const razorpayService = new RazorpayService();
