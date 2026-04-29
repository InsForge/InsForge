import { apiClient } from '../../../lib/api/client';
import type {
  ConfigurePaymentWebhookResponse,
  GetPaymentsConfigResponse,
  GetPaymentsStatusResponse,
  ListPaymentCatalogResponse,
  ListSubscriptionsRequest,
  ListSubscriptionsResponse,
  SyncPaymentsRequest,
  SyncPaymentsResponse,
  StripeEnvironment,
  UpsertPaymentsConfigRequest,
} from '@insforge/shared-schemas';

export class PaymentsService {
  async getStatus(): Promise<GetPaymentsStatusResponse> {
    return apiClient.request('/payments/status', {
      headers: apiClient.withAccessToken(),
    });
  }

  async listCatalog(environment?: StripeEnvironment): Promise<ListPaymentCatalogResponse> {
    const searchParams = new URLSearchParams();
    if (environment) {
      searchParams.set('environment', environment);
    }

    const query = searchParams.toString();
    return apiClient.request(`/payments/catalog${query ? `?${query}` : ''}`, {
      headers: apiClient.withAccessToken(),
    });
  }

  async syncPayments(input: SyncPaymentsRequest): Promise<SyncPaymentsResponse> {
    return apiClient.request('/payments/sync', {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(input),
    });
  }

  async getConfig(): Promise<GetPaymentsConfigResponse> {
    return apiClient.request('/payments/config', {
      headers: apiClient.withAccessToken(),
    });
  }

  async upsertConfig(input: UpsertPaymentsConfigRequest): Promise<GetPaymentsConfigResponse> {
    return apiClient.request('/payments/config', {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(input),
    });
  }

  async removeConfig(environment: StripeEnvironment): Promise<GetPaymentsConfigResponse> {
    return apiClient.request(`/payments/config/${environment}`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }

  async configureWebhook(environment: StripeEnvironment): Promise<ConfigurePaymentWebhookResponse> {
    return apiClient.request(`/payments/webhooks/${environment}/configure`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
    });
  }

  async listSubscriptions(input: ListSubscriptionsRequest): Promise<ListSubscriptionsResponse> {
    const searchParams = new URLSearchParams({
      environment: input.environment,
      limit: String(input.limit),
    });

    if (input.subjectType && input.subjectId) {
      searchParams.set('subjectType', input.subjectType);
      searchParams.set('subjectId', input.subjectId);
    }

    return apiClient.request(`/payments/subscriptions?${searchParams.toString()}`, {
      headers: apiClient.withAccessToken(),
    });
  }
}

export const paymentsService = new PaymentsService();
