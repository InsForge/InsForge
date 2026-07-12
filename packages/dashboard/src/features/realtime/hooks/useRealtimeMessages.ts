import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { realtimeService } from '#features/realtime/services/realtime.service';
import type { ListMessagesRequest } from '@insforge/shared-schemas';
import { useToast } from '@insforge/ui';

export function useRealtimeMessages() {
  const { t } = useTranslation('chrome');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
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

  const clearMessagesMutation = useMutation({
    mutationFn: () => realtimeService.clearMessages(),
    onSuccess: async (data) => {
      setMessagesParams((previousParams) => ({
        ...previousParams,
        offset: 0,
      }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['realtime', 'messages'] }),
        queryClient.invalidateQueries({ queryKey: ['realtime', 'stats'] }),
      ]);
      showToast(
        t('realtime.clearedMessages', {
          count: data.deleted,
          defaultValue_one: 'Cleared {{count}} realtime message.',
          defaultValue_other: 'Cleared {{count}} realtime messages.',
        }),
        'success'
      );
    },
    onError: (mutationError: Error) => {
      showToast(
        mutationError.message ||
          t('realtime.failedToClearMessages', {
            defaultValue: 'Failed to clear realtime messages.',
          }),
        'error'
      );
    },
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
    clearMessages: clearMessagesMutation.mutateAsync,
    isClearingMessages: clearMessagesMutation.isPending,
    refetchMessages,
    refetchStats,
    refetch,
  };
}
