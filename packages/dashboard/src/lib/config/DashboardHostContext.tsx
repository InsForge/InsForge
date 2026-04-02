import { createContext, useContext } from 'react';
import type { DashboardProps } from '../../types';

const DashboardHostContext = createContext<DashboardProps | null>(null);

export const DashboardHostProvider = DashboardHostContext.Provider;

export function useDashboardHost() {
  const value = useContext(DashboardHostContext);
  if (!value) {
    throw new Error('useDashboardHost must be used within an InsForgeDashboard');
  }
  return value;
}

export function useIsCloudHostingMode() {
  return useDashboardHost().mode === 'cloud-hosting';
}
