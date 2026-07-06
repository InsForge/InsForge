import type {
  ConfigureStripeWebhookResponse,
  GetStripeConfigResponse,
  GetStripeStatusResponse,
  ListPaymentCustomersRequest,
  ListPaymentCustomersResponse,
  ListPaymentTransactionsRequest,
  ListPaymentTransactionsResponse,
  ListStripeCatalogResponse,
  ListStripeSubscriptionsRequest,
  ListStripeSubscriptionsResponse,
  SyncStripePaymentsRequest,
  SyncStripePaymentsResponse,
  StripeEnvironment,
  UpsertStripeConfigRequest,
} from '@insforge/shared-schemas';
import { apiClient } from '#lib/api/client';

export class StripeService {
  async getStatus(): Promise<GetStripeStatusResponse> {
    return apiClient.request('/payments/stripe/status', {
      headers: apiClient.withAccessToken(),
    });
  }

  async listCatalog(environment: StripeEnvironment): Promise<ListStripeCatalogResponse> {
    return apiClient.request(`/payments/stripe/${environment}/catalog`, {
      headers: apiClient.withAccessToken(),
    });
  }

  async syncPayments(input: SyncStripePaymentsRequest): Promise<SyncStripePaymentsResponse> {
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

  async getConfig(): Promise<GetStripeConfigResponse> {
    return apiClient.request('/payments/stripe/config', {
      headers: apiClient.withAccessToken(),
    });
  }

  async upsertConfig(input: UpsertStripeConfigRequest): Promise<GetStripeConfigResponse> {
    return apiClient.request(`/payments/stripe/${input.environment}/config`, {
      method: 'PUT',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify({ secretKey: input.secretKey }),
    });
  }

  async removeConfig(environment: StripeEnvironment): Promise<GetStripeConfigResponse> {
    return apiClient.request(`/payments/stripe/${environment}/config`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }

  async configureWebhook(environment: StripeEnvironment): Promise<ConfigureStripeWebhookResponse> {
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
      `/payments/stripe/${input.environment}/transactions?${searchParams.toString()}`,
      {
        headers: apiClient.withAccessToken(),
      }
    );
  }
}

export const stripeService = new StripeService();
