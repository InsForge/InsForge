import { useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../lib/contexts/AuthContext';
import { AppRoutes } from '../router/AppRoutes';
import { ToastProvider } from '../lib/hooks/useToast';
import { SocketProvider } from '../lib/contexts/SocketContext';
import { PostHogAnalyticsProvider } from '../lib/analytics/posthog';
import { ModalProvider } from '../lib/contexts/ModalContext';
import { SQLEditorProvider } from '../features/database/contexts/SQLEditorContext';
import { DashboardHostProvider } from '../lib/config/DashboardHostContext';
import { setDashboardBackendUrl } from '../lib/config/runtime';
import type { DashboardProps } from '../types';

const DEFAULT_SELF_HOSTING_AUTH = { strategy: 'session' } as const;

function DashboardProviderTree({ host }: { host: DashboardProps }) {
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
      <DashboardHostProvider value={host}>
        <AuthProvider>
          <SocketProvider>
            <ToastProvider>
              <PostHogAnalyticsProvider>
                <ModalProvider
                  connectDialogOpen={host.connectDialogOpen}
                  onConnectDialogOpenChange={host.onConnectDialogOpenChange}
                >
                  <SQLEditorProvider>
                    <AppRoutes />
                  </SQLEditorProvider>
                </ModalProvider>
              </PostHogAnalyticsProvider>
            </ToastProvider>
          </SocketProvider>
        </AuthProvider>
      </DashboardHostProvider>
    </QueryClientProvider>
  );
}

export function InsForgeDashboard(props: DashboardProps) {
  const host = useMemo<DashboardProps>(() => {
    const normalizedBackendUrl = props.backendUrl.replace(/\/$/, '');

    if (props.mode === 'self-hosting') {
      return {
        ...props,
        backendUrl: normalizedBackendUrl,
        initialPath: props.initialPath ?? '/dashboard',
        auth: props.auth ?? DEFAULT_SELF_HOSTING_AUTH,
      };
    }

    return {
      ...props,
      backendUrl: normalizedBackendUrl,
    };
  }, [props]);

  return (
    <div className="insforge-dashboard flex h-full min-h-0 min-w-0 flex-col">
      {host.mode === 'self-hosting' ? (
        <BrowserRouter>
          <DashboardProviderTree host={host} />
        </BrowserRouter>
      ) : (
        <MemoryRouter initialEntries={[host.initialPath || '/dashboard']}>
          <DashboardProviderTree host={host} />
        </MemoryRouter>
      )}
    </div>
  );
}
