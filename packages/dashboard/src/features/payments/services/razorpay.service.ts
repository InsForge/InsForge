import type {
  RazorpayEnvironment,
  GetRazorpayWebhookSetupResponse,
  RegenerateRazorpayWebhookSecretResponse,
  GetRazorpayConfigResponse,
  GetRazorpayStatusResponse,
  ListRazorpayCatalogResponse,
  ListPaymentCustomersRequest,
  ListPaymentCustomersResponse,
  ListPaymentTransactionsRequest,
  ListPaymentTransactionsResponse,
  ListRazorpaySubscriptionsRequest,
  ListRazorpaySubscriptionsResponse,
  SyncRazorpayPaymentsRequest,
  SyncRazorpayPaymentsResponse,
  UpsertRazorpayConfigRequest,
} from '@insforge/shared-schemas';
import { apiClient } from '#lib/api/client';

export type {
  GetRazorpayWebhookSetupResponse,
  RegenerateRazorpayWebhookSecretResponse,
  GetRazorpayConfigResponse,
  GetRazorpayStatusResponse,
  ListRazorpayCatalogResponse,
  ListPaymentCustomersRequest,
  ListPaymentCustomersResponse,
  ListPaymentTransactionsRequest,
  ListPaymentTransactionsResponse,
  ListRazorpaySubscriptionsRequest,
  ListRazorpaySubscriptionsResponse,
  SyncRazorpayPaymentsRequest,
  SyncRazorpayPaymentsResponse,
  UpsertRazorpayConfigRequest,
} from '@insforge/shared-schemas';

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

  async getWebhookSetup(
    environment: RazorpayEnvironment
  ): Promise<GetRazorpayWebhookSetupResponse> {
    return apiClient.request(`/payments/razorpay/${environment}/webhook`, {
      headers: apiClient.withAccessToken(),
    });
  }

  async regenerateWebhookSecret(
    environment: RazorpayEnvironment
  ): Promise<RegenerateRazorpayWebhookSecretResponse> {
    return apiClient.request(`/payments/razorpay/${environment}/webhook/regenerate-secret`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
    });
  }

  async syncPayments(input: SyncRazorpayPaymentsRequest): Promise<SyncRazorpayPaymentsResponse> {
    if (input.environment === 'all') {
      return apiClient.request('/payments/razorpay/sync', {
        method: 'POST',
        headers: apiClient.withAccessToken(),
      });
    }

    return apiClient.request(`/payments/razorpay/${input.environment}/sync`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
    });
  }

  async listCatalog(environment: RazorpayEnvironment): Promise<ListRazorpayCatalogResponse> {
    return apiClient.request(`/payments/razorpay/${environment}/catalog`, {
      headers: apiClient.withAccessToken(),
    });
  }

  async listCustomers(input: ListPaymentCustomersRequest): Promise<ListPaymentCustomersResponse> {
    const searchParams = new URLSearchParams({
      limit: String(input.limit),
    });

    return apiClient.request(
      `/payments/razorpay/${input.environment}/customers?${searchParams.toString()}`,
      {
        headers: apiClient.withAccessToken(),
      }
    );
  }

  async listTransactions(
    input: ListPaymentTransactionsRequest
  ): Promise<ListPaymentTransactionsResponse> {
    const searchParams = new URLSearchParams({
      limit: String(input.limit),
    });

    if (input.subjectType && input.subjectId) {
      searchParams.set('subjectType', input.subjectType);
      searchParams.set('subjectId', input.subjectId);
    }

    return apiClient.request(
      `/payments/razorpay/${input.environment}/transactions?${searchParams.toString()}`,
      {
        headers: apiClient.withAccessToken(),
      }
    );
  }

  async listSubscriptions(
    input: ListRazorpaySubscriptionsRequest
  ): Promise<ListRazorpaySubscriptionsResponse> {
    const searchParams = new URLSearchParams({
      limit: String(input.limit),
    });

    if (input.subjectType && input.subjectId) {
      searchParams.set('subjectType', input.subjectType);
      searchParams.set('subjectId', input.subjectId);
    }

    return apiClient.request(
      `/payments/razorpay/${input.environment}/subscriptions?${searchParams.toString()}`,
      {
        headers: apiClient.withAccessToken(),
      }
    );
  }
}

export const razorpayService = new RazorpayService();
