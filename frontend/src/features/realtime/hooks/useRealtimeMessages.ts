import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { realtimeService } from '../services/realtime.service';
import type { ListMessagesRequest } from '@insforge/shared-schemas';

export function useRealtimeMessages() {
  const [messagesParams, setMessagesParams] = useState<ListMessagesRequest>({
    limit: 100,
    offset: 0,
  });

  const {
    data: messages = [],
    isLoading: isLoadingMessages,
    error: messagesError,
    refetch: refetchMessages,
  } = useQuery({
    queryKey: ['realtime', 'messages', messagesParams],
    queryFn: () => realtimeService.listMessages(messagesParams),
    staleTime: 30 * 1000,
  });

  const {
    data: stats,
    isLoading: isLoadingStats,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ['realtime', 'stats'],
    queryFn: () => realtimeService.getMessageStats(),
    staleTime: 60 * 1000,
  });

  const filterMessages = useCallback((params: Partial<ListMessagesRequest>) => {
    setMessagesParams((prev) => ({ ...prev, offset: 0, ...params }));
  }, []);

  const messagesPageSize = messagesParams.limit || 100;
  const messagesCurrentPage = Math.floor((messagesParams.offset || 0) / messagesPageSize) + 1;
  const messagesTotalCount = stats?.totalMessages || 0;
  const messagesTotalPages = Math.ceil(messagesTotalCount / messagesPageSize) || 1;

  const setMessagesPage = useCallback((page: number) => {
    setMessagesParams((prev) => ({
      ...prev,
      offset: (page - 1) * (prev.limit || 100),
    }));
  }, []);

  const refetch = useCallback(() => {
    void refetchMessages();
    void refetchStats();
  }, [refetchMessages, refetchStats]);

  return {
    messages,
    messagesCount: messages.length,
    messagesParams,
    isLoadingMessages,
    messagesError,
    stats,
    isLoadingStats,
    messagesPageSize,
    messagesCurrentPage,
    messagesTotalCount,
    messagesTotalPages,
    setMessagesPage,
    filterMessages,
    refetchMessages,
    refetchStats,
    refetch,
  };
}
