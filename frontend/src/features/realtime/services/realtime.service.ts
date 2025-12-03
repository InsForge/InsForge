import { apiClient } from '@/lib/api/client';
import type {
  RealtimeChannel,
  RealtimeMessage,
  CreateChannelRequest,
  UpdateChannelRequest,
  ListMessagesRequest,
  MessageStatsResponse,
  RlsPolicy,
  RealtimePermissionsResponse,
} from '@insforge/shared-schemas';

export type { RealtimeChannel, RealtimeMessage, RlsPolicy, RealtimePermissionsResponse };

export class RealtimeService {
  // ============================================================================
  // Channels
  // ============================================================================

  async listChannels(): Promise<RealtimeChannel[]> {
    return apiClient.request('/realtime/channels', {
      headers: apiClient.withAccessToken(),
    });
  }

  async getChannel(id: string): Promise<RealtimeChannel> {
    return apiClient.request(`/realtime/channels/${id}`, {
      headers: apiClient.withAccessToken(),
    });
  }

  async createChannel(data: CreateChannelRequest): Promise<RealtimeChannel> {
    return apiClient.request('/realtime/channels', {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(data),
    });
  }

  async updateChannel(id: string, data: UpdateChannelRequest): Promise<RealtimeChannel> {
    return apiClient.request(`/realtime/channels/${id}`, {
      method: 'PUT',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(data),
    });
  }

  async deleteChannel(id: string): Promise<void> {
    return apiClient.request(`/realtime/channels/${id}`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }

  // ============================================================================
  // Messages
  // ============================================================================

  async listMessages(params?: ListMessagesRequest): Promise<RealtimeMessage[]> {
    const searchParams = new URLSearchParams();
    if (params?.channelId) {
      searchParams.set('channelId', params.channelId);
    }
    if (params?.eventName) {
      searchParams.set('eventName', params.eventName);
    }
    if (params?.limit) {
      searchParams.set('limit', String(params.limit));
    }
    if (params?.offset) {
      searchParams.set('offset', String(params.offset));
    }

    const query = searchParams.toString();
    const endpoint = `/realtime/messages${query ? `?${query}` : ''}`;

    return apiClient.request(endpoint, {
      headers: apiClient.withAccessToken(),
    });
  }

  async getMessageStats(channelId?: string): Promise<MessageStatsResponse> {
    const searchParams = new URLSearchParams();
    if (channelId) {
      searchParams.set('channelId', channelId);
    }

    const query = searchParams.toString();
    const endpoint = `/realtime/messages/stats${query ? `?${query}` : ''}`;

    return apiClient.request(endpoint, {
      headers: apiClient.withAccessToken(),
    });
  }

  // ============================================================================
  // Permissions
  // ============================================================================

  async getPermissions(): Promise<RealtimePermissionsResponse> {
    return apiClient.request('/realtime/permissions', {
      headers: apiClient.withAccessToken(),
    });
  }
}

export const realtimeService = new RealtimeService();
