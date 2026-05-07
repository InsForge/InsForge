import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

interface SchedulesConfig {
  retentionDays: number | null;
}

export function useSchedulesConfig() {
  const [config, setConfig] = useState<SchedulesConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch('/api/schedules/config', {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch schedules config');
      }
      const data = await response.json();
      setConfig(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  const updateConfig = useCallback(
    async (updates: Partial<SchedulesConfig>) => {
      try {
        setIsUpdating(true);
        const response = await fetch('/api/schedules/config', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(updates),
        });
        if (!response.ok) {
          throw new Error('Failed to update schedules config');
        }
        toast.success('Schedules config updated');
        await fetchConfig();
      } catch (err) {
        toast.error('Failed to update schedules config');
        throw err;
      } finally {
        setIsUpdating(false);
      }
    },
    [fetchConfig]
  );

  return { config, isLoading, isUpdating, error, updateConfig };
}
