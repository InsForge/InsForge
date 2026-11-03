import type {
  PaystackEnvironment,
  GetPaystackWebhookSetupResponse,
  GetPaystackConfigResponse,
  GetPaystackStatusResponse,
  ListPaymentCustomersRequest,
  ListPaymentCustomersResponse,
  ListPaymentTransactionsRequest,
  ListPaymentTransactionsResponse,
  UpsertPaystackConfigRequest,
} from '@insforge/shared-schemas';
import { apiClient } from '#lib/api/client';

export type {
  GetPaystackWebhookSetupResponse,
  GetPaystackConfigResponse,
  GetPaystackStatusResponse,
  ListPaymentCustomersRequest,
  ListPaymentCustomersResponse,
  ListPaymentTransactionsRequest,
  ListPaymentTransactionsResponse,
  UpsertPaystackConfigRequest,
} from '@insforge/shared-schemas';

export class PaystackService {
  async getStatus(): Promise<GetPaystackStatusResponse> {
    return apiClient.request('/payments/paystack/status', {
      headers: apiClient.withAccessToken(),
    });
  }

  async getConfig(): Promise<GetPaystackConfigResponse> {
    return apiClient.request('/payments/paystack/config', {
      headers: apiClient.withAccessToken(),
    });
  }

  async upsertConfig(input: UpsertPaystackConfigRequest): Promise<GetPaystackConfigResponse> {
    // publicKey is a tri-state update: undefined = keep existing, null = clear,
    // string = set. Omit it from the body only when undefined so an explicit
    // null reaches the backend.
    const body: Record<string, string | null> = { secretKey: input.secretKey };
    if (input.publicKey !== undefined) {
      body.publicKey = input.publicKey;
    }
    return apiClient.request(`/payments/paystack/${input.environment}/config`, {
      method: 'PUT',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(body),
    });
  }

  async removeConfig(environment: PaystackEnvironment): Promise<GetPaystackConfigResponse> {
    return apiClient.request(`/payments/paystack/${environment}/config`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }

  async getWebhookSetup(
    environment: PaystackEnvironment
  ): Promise<GetPaystackWebhookSetupResponse> {
    return apiClient.request(`/payments/paystack/${environment}/webhook`, {
      headers: apiClient.withAccessToken(),
    });
  }

  async listCustomers(input: ListPaymentCustomersRequest): Promise<ListPaymentCustomersResponse> {
    const searchParams = new URLSearchParams({
      limit: String(input.limit),
    });

    return apiClient.request(
      `/payments/paystack/${input.environment}/customers?${searchParams.toString()}`,
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
      `/payments/paystack/${input.environment}/transactions?${searchParams.toString()}`,
      {
        headers: apiClient.withAccessToken(),
      }
    );
  }
}

export const paystackService = new PaystackService();
