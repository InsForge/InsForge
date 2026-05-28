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
  ): Promise<SyncRazorpayPaymentsResponse | SyncRazorpayPaymentsResponse[]> {
    if (input.environment === 'all') {
      const results = await Promise.allSettled([
        this.syncPayments({ environment: 'test' }),
        this.syncPayments({ environment: 'live' }),
      ]);

      const successes = results
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .map((r) => r.value);

      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

      if (successes.length === 0 && failures.length > 0) {
        throw failures[0].reason;
      }

      return successes as SyncRazorpayPaymentsResponse[];
    }

    return apiClient.request(`/payments/razorpay/${input.environment}/sync`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
    });
  }
}

export const razorpayService = new RazorpayService();
