import type {
  ConfigurePaymentWebhookResponse,
  GetPaymentsConfigResponse,
  GetPaymentsStatusResponse,
  ListPaymentCustomersRequest,
  ListPaymentCustomersResponse,
  ListPaymentActivityRequest,
  ListPaymentActivityResponse,
  ListStripeCatalogResponse,
  ListStripeSubscriptionsRequest,
  ListStripeSubscriptionsResponse,
  SyncPaymentsRequest,
  SyncPaymentsResponse,
  StripeEnvironment,
  UpsertPaymentsConfigRequest,
} from '@insforge/shared-schemas';
import { apiClient } from '#lib/api/client';

export class PaymentsService {
  async getStatus(): Promise<GetPaymentsStatusResponse> {
    return apiClient.request('/payments/stripe/status', {
      headers: apiClient.withAccessToken(),
    });
  }

  async listCatalog(environment: StripeEnvironment): Promise<ListStripeCatalogResponse> {
    return apiClient.request(`/payments/stripe/${environment}/catalog`, {
      headers: apiClient.withAccessToken(),
    });
  }

  async syncPayments(input: SyncPaymentsRequest): Promise<SyncPaymentsResponse> {
    if (input.environment === 'all') {
      return apiClient.request('/payments/stripe/sync', {
        method: 'POST',
        headers: apiClient.withAccessToken(),
      });
    }

    return apiClient.request(`/payments/stripe/${input.environment}/sync`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
    });
  }

  async getConfig(): Promise<GetPaymentsConfigResponse> {
    return apiClient.request('/payments/stripe/config', {
      headers: apiClient.withAccessToken(),
    });
  }

  async upsertConfig(input: UpsertPaymentsConfigRequest): Promise<GetPaymentsConfigResponse> {
    return apiClient.request(`/payments/stripe/${input.environment}/config`, {
      method: 'PUT',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify({ secretKey: input.secretKey }),
    });
  }

  async removeConfig(environment: StripeEnvironment): Promise<GetPaymentsConfigResponse> {
    return apiClient.request(`/payments/stripe/${environment}/config`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }

  async configureWebhook(environment: StripeEnvironment): Promise<ConfigurePaymentWebhookResponse> {
    return apiClient.request(`/payments/stripe/${environment}/webhook`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
    });
  }

  async listSubscriptions(
    input: ListStripeSubscriptionsRequest
  ): Promise<ListStripeSubscriptionsResponse> {
    const searchParams = new URLSearchParams({
      limit: String(input.limit),
    });

    if (input.subjectType && input.subjectId) {
      searchParams.set('subjectType', input.subjectType);
      searchParams.set('subjectId', input.subjectId);
    }

    return apiClient.request(
      `/payments/stripe/${input.environment}/subscriptions?${searchParams.toString()}`,
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
      `/payments/stripe/${input.environment}/customers?${searchParams.toString()}`,
      {
        headers: apiClient.withAccessToken(),
      }
    );
  }

  async listPaymentActivity(
    input: ListPaymentActivityRequest
  ): Promise<ListPaymentActivityResponse> {
    const searchParams = new URLSearchParams({
      limit: String(input.limit),
    });

    if (input.subjectType && input.subjectId) {
      searchParams.set('subjectType', input.subjectType);
      searchParams.set('subjectId', input.subjectId);
    }

    return apiClient.request(
      `/payments/stripe/${input.environment}/payment-activity?${searchParams.toString()}`,
      {
        headers: apiClient.withAccessToken(),
      }
    );
  }
}

export const paymentsService = new PaymentsService();
