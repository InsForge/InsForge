import { apiClient } from '#lib/api/client';
import type {
  DashboardAdvisorSummary,
  DashboardAdvisorIssuesQuery,
  DashboardAdvisorIssuesResponse,
} from '#types';

export class AdvisorService {
  async getLatest(): Promise<DashboardAdvisorSummary | null> {
    return apiClient.request('/advisor/latest', {
      method: 'GET',
      headers: apiClient.withAccessToken({}),
    });
  }

  async getIssues(query: DashboardAdvisorIssuesQuery): Promise<DashboardAdvisorIssuesResponse> {
    const params = new URLSearchParams();
    if (query.severity) {
      params.append('severity', query.severity);
    }
    if (query.category) {
      params.append('category', query.category);
    }
    if (query.limit !== undefined) {
      params.append('limit', String(query.limit));
    }
    if (query.offset !== undefined) {
      params.append('offset', String(query.offset));
    }

    const queryString = params.toString() ? `?${params.toString()}` : '';
    return apiClient.request(`/advisor/issues${queryString}`, {
      method: 'GET',
      headers: apiClient.withAccessToken({}),
    });
  }

  async triggerScan(): Promise<void> {
    await apiClient.request('/advisor/scan', {
      method: 'POST',
      headers: apiClient.withAccessToken({}),
    });
  }
}

export const advisorService = new AdvisorService();
