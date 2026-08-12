import { useQuery } from '@tanstack/react-query';
import {
  useDashboardHost,
  useDashboardProject,
  useIsCloudHostingMode,
} from '#lib/config/DashboardHostContext';
import type { DashboardInstanceInfo } from '#types';

/**
 * Whether this project may use the AI Model Gateway, and if not, why.
 *
 * Cloud gates AI on the org: free orgs created after the AI cutoff need a paid
 * plan, and white-labeled partner orgs are excluded outright. Self-hosting
 * brings its own key, so it is always allowed.
 *
 * `isPartnerOrg` has to be carried explicitly — cloud reports partner orgs as
 * the Team plan, so planName alone cannot distinguish them.
 */
export type AiEntitlementReason = 'plan' | 'partner';

export function useAiEntitlement(): {
  isLoading: boolean;
  allowed: boolean;
  reason: AiEntitlementReason | null;
} {
  const host = useDashboardHost();
  const project = useDashboardProject();
  const isCloudHostingMode = useIsCloudHostingMode();
  const onRequestInstanceInfo =
    host.mode === 'cloud-hosting' ? host.onRequestInstanceInfo : undefined;
  const enabled = isCloudHostingMode && !!onRequestInstanceInfo;

  const query = useQuery({
    // Scoped to the project: entitlement is an org-level answer, and switching
    // project without remounting the QueryClient would otherwise serve the
    // previous org's verdict for the whole staleTime.
    queryKey: ['instance-info', project?.id ?? null],
    queryFn: (): Promise<DashboardInstanceInfo | null> =>
      onRequestInstanceInfo ? onRequestInstanceInfo() : Promise.resolve(null),
    enabled,
    // The bridge self-terminates at DEFAULT_TIMEOUT_MS (15s) and rejects, but
    // react-query's default 3 retries would stack that into ~a minute of
    // spinner on a hung parent. One attempt, then fail open — same convention
    // as useOpenRouterKey.
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  if (!enabled) {
    return { isLoading: false, allowed: true, reason: null };
  }

  // Fail open while loading and on error: a transient bridge failure should not
  // flash an upgrade wall at a paying customer. Cloud still enforces the real
  // gate — the worst case is a page that renders and then 403s.
  if (query.isLoading || !query.data) {
    return { isLoading: query.isLoading, allowed: true, reason: null };
  }

  if (query.data.isPartnerOrg) {
    return { isLoading: false, allowed: false, reason: 'partner' };
  }
  if ((query.data.planName || '').toLowerCase() === 'free') {
    return { isLoading: false, allowed: false, reason: 'plan' };
  }
  return { isLoading: false, allowed: true, reason: null };
}
