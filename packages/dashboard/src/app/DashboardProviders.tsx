import type { PropsWithChildren } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { DashboardHostProvider } from '../lib/config/DashboardHostContext';
import { setDashboardBackendUrl } from '../lib/config/runtime';
import type { DashboardProps } from '../types';

interface DashboardProvidersProps extends PropsWithChildren {
  queryClient: QueryClient;
  host: DashboardProps;
}

export function DashboardProviders({ children, queryClient, host }: DashboardProvidersProps) {
  setDashboardBackendUrl(host.backendUrl);

  return (
    <QueryClientProvider client={queryClient}>
      <DashboardHostProvider value={host}>{children}</DashboardHostProvider>
    </QueryClientProvider>
  );
}
