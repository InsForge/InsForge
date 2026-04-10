import { createContext, useContext } from 'react';
import type {
  CloudHostingDashboardProps,
  DashboardProjectInfo,
  SelfHostingDashboardProps,
} from '../../types';

type DashboardHostContextValue =
  | Omit<SelfHostingDashboardProps, 'project'>
  | Omit<CloudHostingDashboardProps, 'project'>;

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
