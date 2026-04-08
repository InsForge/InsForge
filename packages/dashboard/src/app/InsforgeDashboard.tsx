import { useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../lib/contexts/AuthContext';
import { AppRoutes } from '../router/AppRoutes';
import { ToastProvider } from '../lib/hooks/useToast';
import { SocketProvider } from '../lib/contexts/SocketContext';
import { PostHogAnalyticsProvider } from '../lib/analytics/posthog';
import { ModalProvider } from '../lib/contexts/ModalContext';
import { SQLEditorProvider } from '../features/database/contexts/SQLEditorContext';
import { DashboardHostProvider } from '../lib/config/DashboardHostContext';
import { setDashboardBackendUrl } from '../lib/config/runtime';
import type { InsForgeDashboardProps } from '../types';

function normalizeBackendUrl(url?: string) {
  return url?.replace(/\/$/, '') || undefined;
}

export function InsForgeDashboard(props: InsForgeDashboardProps) {
  const host = useMemo<InsForgeDashboardProps>(
    () => ({
      ...props,
      backendUrl: normalizeBackendUrl(props.backendUrl),
    }),
    [props]
  );
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
    <div className="insforge-dashboard flex h-full min-h-0 min-w-0 flex-col">
      <BrowserRouter>
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
      </BrowserRouter>
    </div>
  );
}
