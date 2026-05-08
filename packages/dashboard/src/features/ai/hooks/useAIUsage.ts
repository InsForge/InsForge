import { useQuery } from '@tanstack/react-query';
import { aiService } from '#features/ai/services/ai.service';
import {
  AIUsageSummarySchema,
  AIUsageRecordSchema,
  ListAIUsageResponse,
} from '@insforge/shared-schemas';

interface UseAIUsageSummaryOptions {
  configId?: string;
  startDate?: string;
  endDate?: string;
  enabled?: boolean;
}

export function useAIUsageSummary(options: UseAIUsageSummaryOptions = {}) {
  const { configId, startDate, endDate, enabled = true } = options;

  return useQuery<AIUsageSummarySchema>({
    queryKey: ['ai-usage-summary', configId, startDate, endDate],
    queryFn: () => aiService.getUsageSummary({ configId, startDate, endDate }),
    enabled: enabled,
    staleTime: 60 * 1000, // Cache for 1 minute
  });
}

interface UseAIUsageRecordsOptions {
  startDate?: string;
  endDate?: string;
  limit?: string;
  offset?: string;
  enabled?: boolean;
}

export function useAIUsageRecords(options: UseAIUsageRecordsOptions = {}) {
  const { startDate, endDate, limit = '50', offset = '0', enabled = true } = options;

  return useQuery<ListAIUsageResponse>({
    queryKey: ['ai-usage-records', startDate, endDate, limit, offset],
    queryFn: () => aiService.getUsageRecords({ startDate, endDate, limit, offset }),
    enabled: enabled,
    staleTime: 60 * 1000, // Cache for 1 minute
  });
}

interface UseAIConfigUsageOptions {
  configId: string;
  startDate?: string;
  endDate?: string;
  enabled?: boolean;
}

export function useAIConfigUsage(options: UseAIConfigUsageOptions) {
  const { configId, startDate, endDate, enabled = true } = options;

  return useQuery<AIUsageRecordSchema[]>({
    queryKey: ['ai-config-usage', configId, startDate, endDate],
    queryFn: () => aiService.getConfigUsageRecords(configId, { startDate, endDate }),
    enabled: enabled && !!configId,
    staleTime: 60 * 1000, // Cache for 1 minute
  });
}

export function useAIRemainingCredits(enabled = true) {
  return useQuery<{
    usage: number;
    limit: number | null;
    remaining: number | null;
  }>({
    queryKey: ['ai-remaining-credits'],
    queryFn: () => aiService.getRemainingCredits(),
    enabled: enabled,
    retry: false,
  });
}
