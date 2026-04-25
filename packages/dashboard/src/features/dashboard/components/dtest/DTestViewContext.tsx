import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useMcpUsage } from '../../../logs/hooks/useMcpUsage';
import { getFeatureFlag } from '../../../../lib/analytics/posthog';
import type { ClientId } from './clientRegistry';

export type DTestView = 'install' | 'dashboard';

interface DTestViewContextValue {
  view: DTestView;
  setView: (view: DTestView) => void;
  selectedClient: ClientId | null;
  setSelectedClient: (id: ClientId | null) => void;
  isLoading: boolean;
}

const DTestViewContext = createContext<DTestViewContextValue | null>(null);

export function DTestViewProvider({ children }: { children: ReactNode }) {
  const { hasCompletedOnboarding, isLoading } = useMcpUsage();
  const [selectedClient, setSelectedClient] = useState<ClientId | null>(null);
  const [view, setViewState] = useState<DTestView>('install');

  // Initialise view from onboarding state once loading finishes; afterwards,
  // auto-flip to dashboard whenever onboarding transitions false → true
  // (covers the "MCP call completes → jump to dashboard" UX).
  const didInit = useRef(false);
  const prevOnboarding = useRef(hasCompletedOnboarding);
  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (!didInit.current) {
      setViewState(hasCompletedOnboarding ? 'dashboard' : 'install');
      didInit.current = true;
    } else if (!prevOnboarding.current && hasCompletedOnboarding) {
      setViewState('dashboard');
    }
    prevOnboarding.current = hasCompletedOnboarding;
  }, [hasCompletedOnboarding, isLoading]);

  const setView = useCallback((next: DTestView) => {
    setViewState(next);
    if (next === 'dashboard') {
      setSelectedClient(null);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) {
      return;
    }
    if (getFeatureFlag('dashboard-v4-experiment') !== 'd_test') {
      return;
    }
    window.parent.postMessage({ type: 'D_TEST_VIEW_CHANGED', view }, '*');
  }, [view]);

  return (
    <DTestViewContext.Provider
      value={{ view, setView, selectedClient, setSelectedClient, isLoading }}
    >
      {children}
    </DTestViewContext.Provider>
  );
}

export function useDTestView(): DTestViewContextValue {
  const ctx = useContext(DTestViewContext);
  if (!ctx) {
    throw new Error('useDTestView must be used within a DTestViewProvider');
  }
  return ctx;
}
