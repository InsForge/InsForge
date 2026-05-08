import type {
  ConfigurePaymentWebhookResponse,
  GetPaymentsConfigResponse,
  GetPaymentsStatusResponse,
  ListPaymentCustomersRequest,
  ListPaymentCustomersResponse,
  ListPaymentHistoryRequest,
  ListPaymentHistoryResponse,
  ListPaymentCatalogResponse,
  ListSubscriptionsRequest,
  ListSubscriptionsResponse,
  SyncPaymentsRequest,
  SyncPaymentsResponse,
  StripeEnvironment,
  UpsertPaymentsConfigRequest,
} from '@insforge/shared-schemas';
import { apiClient } from '#lib/api/client';

export class PaymentsService {
  async getStatus(): Promise<GetPaymentsStatusResponse> {
    return apiClient.request('/payments/status', {
      headers: apiClient.withAccessToken(),
    });
  }

  async listCatalog(environment: StripeEnvironment): Promise<ListPaymentCatalogResponse> {
    return apiClient.request(`/payments/${environment}/catalog`, {
      headers: apiClient.withAccessToken(),
    });
  }

  async syncPayments(input: SyncPaymentsRequest): Promise<SyncPaymentsResponse> {
    if (input.environment === 'all') {
      return apiClient.request('/payments/sync', {
        method: 'POST',
        headers: apiClient.withAccessToken(),
      });
    }

    return apiClient.request(`/payments/${input.environment}/sync`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
    });
  }

  async getConfig(): Promise<GetPaymentsConfigResponse> {
    return apiClient.request('/payments/config', {
      headers: apiClient.withAccessToken(),
    });
  }

  async upsertConfig(input: UpsertPaymentsConfigRequest): Promise<GetPaymentsConfigResponse> {
    return apiClient.request(`/payments/${input.environment}/config`, {
      method: 'PUT',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify({ secretKey: input.secretKey }),
    });
  }

  async removeConfig(environment: StripeEnvironment): Promise<GetPaymentsConfigResponse> {
    return apiClient.request(`/payments/${environment}/config`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }

  async configureWebhook(environment: StripeEnvironment): Promise<ConfigurePaymentWebhookResponse> {
    return apiClient.request(`/payments/${environment}/webhook`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
    });
  }

  async listSubscriptions(input: ListSubscriptionsRequest): Promise<ListSubscriptionsResponse> {
    const searchParams = new URLSearchParams({
      limit: String(input.limit),
    });

    if (input.subjectType && input.subjectId) {
      searchParams.set('subjectType', input.subjectType);
      searchParams.set('subjectId', input.subjectId);
    }

    return apiClient.request(
      `/payments/${input.environment}/subscriptions?${searchParams.toString()}`,
      {
        headers: apiClient.withAccessToken(),
      }
    );
  }

  async listCustomers(input: ListPaymentCustomersRequest): Promise<ListPaymentCustomersResponse> {
    const searchParams = new URLSearchParams({
      limit: String(input.limit),
    });

    return apiClient.request(
      `/payments/${input.environment}/customers?${searchParams.toString()}`,
      {
        headers: apiClient.withAccessToken(),
      }
    );
  }

  async listPaymentHistory(input: ListPaymentHistoryRequest): Promise<ListPaymentHistoryResponse> {
    const searchParams = new URLSearchParams({
      limit: String(input.limit),
    });

    if (input.subjectType && input.subjectId) {
      searchParams.set('subjectType', input.subjectType);
      searchParams.set('subjectId', input.subjectId);
    }

    return apiClient.request(
      `/payments/${input.environment}/payment-history?${searchParams.toString()}`,
      {
        headers: apiClient.withAccessToken(),
      }
    );
  }
}

export const paymentsService = new PaymentsService();
