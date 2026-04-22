import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ClientId } from './clientRegistry';

export type DTestView = 'install' | 'dashboard';

const getDismissKey = (projectId: string | null | undefined) =>
  `insforge-dtest-install-dismissed-${projectId || 'default'}`;

function readDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function writeDismissed(key: string, value: boolean): void {
  try {
    if (value) {
      localStorage.setItem(key, 'true');
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // noop (privacy mode / SSR)
  }
}

interface UseDTestViewArgs {
  hasCompletedOnboarding: boolean;
  projectId: string | null | undefined;
}

export function useDTestView({ hasCompletedOnboarding, projectId }: UseDTestViewArgs) {
  const [params, setParams] = useSearchParams();
  const dismissKey = getDismissKey(projectId);
  const [selectedClient, setSelectedClient] = useState<ClientId | null>(null);

  // Mirror the localStorage dismissal flag in React state so view resolution
  // reacts to changes without relying on URL churn.
  const [isDismissed, setIsDismissed] = useState(() => readDismissed(dismissKey));

  // Re-sync when the project (and therefore storage key) changes.
  useEffect(() => {
    setIsDismissed(readDismissed(dismissKey));
  }, [dismissKey]);

  // Persist dismissal the first time onboarding completes, so a later loss of
  // MCP usage history does not bounce the user back to the install page.
  useEffect(() => {
    if (projectId && hasCompletedOnboarding && !isDismissed) {
      writeDismissed(dismissKey, true);
      setIsDismissed(true);
    }
  }, [hasCompletedOnboarding, projectId, dismissKey, isDismissed]);

  const view: DTestView = useMemo(() => {
    const urlView = params.get('view');
    if (urlView === 'install') {
      return 'install';
    }
    if (urlView === 'dashboard') {
      return 'dashboard';
    }
    // no param → compute default
    if (isDismissed) {
      return 'dashboard';
    }
    return hasCompletedOnboarding ? 'dashboard' : 'install';
  }, [params, hasCompletedOnboarding, isDismissed]);

  const setView = useCallback(
    (v: DTestView, options?: { dismiss?: boolean }) => {
      const next = new URLSearchParams(params);
      next.set('view', v);
      setParams(next, { replace: true });
      if (v === 'dashboard') {
        setSelectedClient(null);
      }
      if (options?.dismiss) {
        writeDismissed(dismissKey, true);
        setIsDismissed(true);
      }
    },
    [params, setParams, dismissKey]
  );

  return {
    view,
    setView,
    selectedClient,
    setSelectedClient,
  };
}
