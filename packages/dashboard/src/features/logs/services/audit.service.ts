import { apiClient } from '#lib/api/client';
import {
  GetAuditLogsResponse,
  ClearAuditLogsResponse,
  GetAuditLogsRequest,
} from '@insforge/shared-schemas';

export class AuditService {
  async getAuditLogs({
    limit = 100,
    offset = 0,
    ...filters
  }: GetAuditLogsRequest): Promise<GetAuditLogsResponse> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    });

    if (filters?.actor) {
      params.append('actor', filters.actor);
    }
    if (filters?.action) {
      params.append('action', filters.action);
    }
    if (filters?.module) {
      params.append('module', filters.module);
    }
    if (filters?.startDate) {
      params.append('start_date', filters.startDate);
    }
    if (filters?.endDate) {
      params.append('end_date', filters.endDate);
    }

    return apiClient.request(`/logs/audits?${params.toString()}`, {
      headers: apiClient.withAccessToken(),
    });
  }

  async clearAuditLogs(daysToKeep = 90): Promise<ClearAuditLogsResponse> {
    const params = new URLSearchParams({
      days_to_keep: daysToKeep.toString(),
    });

    return apiClient.request(`/logs/audits?${params.toString()}`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }
}

export const auditService = new AuditService();
