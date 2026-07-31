import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { DashboardDataUpdateEvent, DashboardEvent } from '@insforge/shared-schemas';
import { useAuth } from './AuthContext';
import { databaseTableQueryKeys } from '#features/database/queryKeys';
import { parseDatabaseTableReference } from '#features/database/helpers';
import { useMcpUsage } from '#features/logs/hooks/useMcpUsage';
import { trackEvent, getFeatureFlag } from '#lib/analytics/posthog';
import { ANALYTICS_EVENTS, FEATURE_FLAGS } from '#lib/analytics/constants';
import { connectDashboardEventStream } from '#lib/services/dashboard-events.service';

const INVALIDATION_DEBOUNCE_MS = 300;
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export function getDashboardInvalidationKeys(event: DashboardDataUpdateEvent): QueryKey[] {
  switch (event.resource) {
    case 'database': {
      const changes = event.data?.changes;
      if (!changes || changes.length === 0) {
        return [['database'], ['records'], ['metadata', 'full']];
      }

      const keys: QueryKey[] = [];
      for (const change of changes) {
        switch (change.type) {
          case 'tables':
            keys.push(['database', 'tables'], ['metadata', 'full']);
            break;
          case 'table':
            keys.push(['database', 'tables']);
            if (change.name) {
              const { schemaName, tableName } = parseDatabaseTableReference(change.name);
              keys.push(databaseTableQueryKeys.tableSchema(schemaName, tableName));
            }
            break;
          case 'records':
            if (change.name) {
              const { schemaName, tableName } = parseDatabaseTableReference(change.name);
              keys.push(['records', schemaName, tableName]);
            }
            keys.push(['metadata', 'full']);
            break;
          case 'index':
            keys.push(['database', 'indexes']);
            break;
          case 'trigger':
            keys.push(['database', 'triggers']);
            break;
          case 'policy':
            keys.push(['database', 'policies']);
            break;
          case 'function':
            keys.push(['database', 'functions']);
            break;
          case 'migration':
            keys.push(['database', 'migrations']);
            break;
          case 'extension':
            break;
        }
      }
      return keys;
    }
    case 'buckets':
      return [
        ['storage', 'buckets'],
        ['metadata', 'full'],
      ];
    case 'users':
      return [['users']];
    case 'functions':
      return [['functions']];
    case 'deployments':
      return [['deployment-metadata']];
    case 'realtime':
      return [['realtime']];
    case 'compute_services':
      return [['compute', 'services']];
  }
}

interface DashboardEventsProviderProps {
  children: ReactNode;
}

export function DashboardEventsProvider({ children }: DashboardEventsProviderProps) {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const { recordsCount: mcpUsageCount } = useMcpUsage();
  const pendingInvalidationsRef = useRef<Map<string, QueryKey>>(new Map());
  const invalidationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasConnectedRef = useRef(false);
  const mcpUsageCountRef = useRef(mcpUsageCount);

  useEffect(() => {
    mcpUsageCountRef.current = mcpUsageCount;
  }, [mcpUsageCount]);

  const flushInvalidations = useCallback(() => {
    invalidationTimerRef.current = null;
    const queryKeys = Array.from(pendingInvalidationsRef.current.values());
    pendingInvalidationsRef.current.clear();
    for (const queryKey of queryKeys) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [queryClient]);

  const scheduleInvalidate = useCallback(
    (queryKey: QueryKey) => {
      pendingInvalidationsRef.current.set(JSON.stringify(queryKey), queryKey);
      if (invalidationTimerRef.current === null) {
        invalidationTimerRef.current = setTimeout(flushInvalidations, INVALIDATION_DEBOUNCE_MS);
      }
    },
    [flushInvalidations]
  );

  const handleEvent = useCallback(
    (event: DashboardEvent) => {
      if (event.type === 'ready') {
        if (hasConnectedRef.current) {
          void queryClient.invalidateQueries();
        }
        hasConnectedRef.current = true;
        return;
      }

      if (event.type === 'data-update') {
        for (const queryKey of getDashboardInvalidationKeys(event)) {
          scheduleInvalidate(queryKey);
        }
        return;
      }

      void queryClient.invalidateQueries({ queryKey: ['mcp-usage'] });
      if (mcpUsageCountRef.current === 1) {
        trackEvent(ANALYTICS_EVENTS.ONBOARDING_COMPLETED, {
          experiment_variant: getFeatureFlag(FEATURE_FLAGS.DASHBOARD_V4_EXPERIMENT),
          mcp_vs_cli_variant: getFeatureFlag(FEATURE_FLAGS.MCP_VS_CLI),
          tool_name: event.toolName,
        });
      }
    },
    [queryClient, scheduleInvalidate]
  );

  useEffect(() => {
    if (!isAuthenticated) {
      hasConnectedRef.current = false;
      return;
    }

    const controller = new AbortController();
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;

    const connect = async () => {
      try {
        await connectDashboardEventStream(controller.signal, (event) => {
          if (event.type === 'ready') {
            reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
          }
          handleEvent(event);
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn('Dashboard event stream disconnected', error);
        }
      }

      if (!controller.signal.aborted) {
        const delay = reconnectDelay;
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
        reconnectTimer = setTimeout(() => void connect(), delay);
      }
    };

    void connect();
    return () => {
      controller.abort();
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
      }
    };
  }, [handleEvent, isAuthenticated]);

  useEffect(() => {
    return () => {
      if (invalidationTimerRef.current !== null) {
        clearTimeout(invalidationTimerRef.current);
      }
    };
  }, []);

  return children;
}
