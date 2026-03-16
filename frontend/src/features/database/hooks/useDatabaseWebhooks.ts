import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import type {
  DatabaseWebhook,
  DatabaseWebhookLog,
  CreateDatabaseWebhookRequest,
  UpdateDatabaseWebhookRequest,
} from '@insforge/shared-schemas';

const WEBHOOKS_KEY = ['database-webhooks'] as const;

async function listWebhooks(): Promise<DatabaseWebhook[]> {
  return apiClient.request('/database/webhooks', {
    headers: apiClient.withAccessToken(),
  });
}

async function createWebhookApi(input: CreateDatabaseWebhookRequest): Promise<DatabaseWebhook> {
  return apiClient.request('/database/webhooks', {
    method: 'POST',
    headers: apiClient.withAccessToken(),
    body: JSON.stringify(input),
  });
}

async function deleteWebhookApi(id: string): Promise<void> {
  return apiClient.request(`/database/webhooks/${id}`, {
    method: 'DELETE',
    headers: apiClient.withAccessToken(),
  });
}

async function updateWebhookApi(
  id: string,
  input: UpdateDatabaseWebhookRequest
): Promise<DatabaseWebhook> {
  return apiClient.request(`/database/webhooks/${id}`, {
    method: 'PATCH',
    headers: apiClient.withAccessToken(),
    body: JSON.stringify(input),
  });
}

async function listLogsApi(webhookId: string): Promise<DatabaseWebhookLog[]> {
  return apiClient.request(`/database/webhooks/${webhookId}/logs?limit=20&offset=0`, {
    headers: apiClient.withAccessToken(),
  });
}

export function useDatabaseWebhooks() {
  const queryClient = useQueryClient();
  const [logs, setLogs] = useState<Record<string, DatabaseWebhookLog[]>>({});

  const {
    data: webhooks = [],
    isLoading,
    error,
    refetch,
  } = useQuery<DatabaseWebhook[]>({
    queryKey: WEBHOOKS_KEY,
    queryFn: listWebhooks,
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateDatabaseWebhookRequest) => createWebhookApi(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WEBHOOKS_KEY });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteWebhookApi(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WEBHOOKS_KEY });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateWebhookApi(id, { enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WEBHOOKS_KEY });
    },
  });

  const fetchLogs = useCallback(async (webhookId: string) => {
    const result = await listLogsApi(webhookId);
    setLogs((prev) => ({ ...prev, [webhookId]: result }));
  }, []);

  return {
    webhooks,
    logs,
    isLoading,
    error,
    refetch,
    createWebhook: createMutation.mutateAsync,
    deleteWebhook: (id: string) => deleteMutation.mutateAsync(id),
    toggleWebhook: (id: string, enabled: boolean) => toggleMutation.mutateAsync({ id, enabled }),
    fetchLogs,
  };
}
