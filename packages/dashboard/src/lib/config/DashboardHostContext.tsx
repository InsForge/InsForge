import { createContext, useContext } from 'react';
import type {
  DashboardInstanceInfo,
  DashboardMode,
  DashboardProjectInfo,
  DashboardUserInfo,
} from '../../types';

interface DashboardHostContextValue {
  backendUrl?: string;
  showNavbar?: boolean;
  mode: DashboardMode;
  getAuthorizationCode?: () => Promise<string>;
  useAuthorizationCodeRefresh?: boolean;
  onRouteChange?: (path: string) => void;
  onNavigateToSubscription?: () => void;
  onRenameProject?: (name: string) => Promise<void>;
  onDeleteProject?: () => Promise<void>;
  onRequestInstanceInfo?: () => Promise<DashboardInstanceInfo>;
  onRequestInstanceTypeChange?: (
    instanceType: string
  ) => Promise<{ success: boolean; instanceType?: string; error?: string }>;
  onUpdateVersion?: () => Promise<void>;
  onRequestUserInfo?: () => Promise<DashboardUserInfo>;
}

const DashboardHostContext = createContext<DashboardHostContextValue | null>(null);
const DashboardProjectContext = createContext<DashboardProjectInfo | undefined>(undefined);

export const DashboardHostProvider = DashboardHostContext.Provider;
export const DashboardProjectProvider = DashboardProjectContext.Provider;

export function useDashboardHost() {
  const value = useContext(DashboardHostContext);
  if (!value) {
    throw new Error('useDashboardHost must be used within an InsForgeDashboard');
  }
  return value;
}

export function useDashboardProject() {
  return useContext(DashboardProjectContext);
}

export function useIsCloudHostingMode() {
  return useDashboardHost().mode === 'cloud-hosting';
}
