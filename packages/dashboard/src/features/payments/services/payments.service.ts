import { apiClient } from '../../../lib/api/client';
import type {
  GetPaymentsConfigResponse,
  GetPaymentsStatusResponse,
  ListPaymentCatalogResponse,
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

  async syncCatalog(
    environment: SyncPaymentsRequest['environment']
  ): Promise<SyncPaymentsResponse> {
    return apiClient.request('/payments/sync', {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify({ environment }),
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
}

export const paymentsService = new PaymentsService();
