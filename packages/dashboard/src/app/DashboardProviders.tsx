import { useState, type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardHostProvider } from '../lib/config/DashboardHostContext';
import { setDashboardBackendUrl } from '../lib/config/runtime';
import type { DashboardProps } from '../types';

interface DashboardProvidersProps extends PropsWithChildren {
  host: DashboardProps;
}

export function DashboardProviders({ children, host }: DashboardProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            gcTime: 10 * 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  setDashboardBackendUrl(host.backendUrl);

  return (
    <QueryClientProvider client={queryClient}>
      <DashboardHostProvider value={host}>{children}</DashboardHostProvider>
    </QueryClientProvider>
  );
}
