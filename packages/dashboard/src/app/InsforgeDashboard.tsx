import { useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../lib/contexts/AuthContext';
import { AppRoutes } from '../router/AppRoutes';
import { ToastProvider } from '../lib/hooks/useToast';
import { SocketProvider } from '../lib/contexts/SocketContext';
import { PostHogAnalyticsProvider } from '../lib/analytics/posthog';
import { SQLEditorProvider } from '../features/database/contexts/SQLEditorContext';
import { DashboardHostProvider, DashboardProjectProvider } from '../lib/config/DashboardHostContext';
import { setDashboardBackendUrl } from '../lib/config/runtime';
import type {
  CloudHostingDashboardProps,
  InsForgeDashboardProps,
  SelfHostingDashboardProps,
} from '../types';

function normalizeBackendUrl(url?: string) {
  return url?.replace(/\/$/, '') || undefined;
}

export function InsForgeDashboard(props: InsForgeDashboardProps) {
  const { project, ...hostProps } = props;
  const host = useMemo<
    | Omit<SelfHostingDashboardProps, 'project'>
    | Omit<CloudHostingDashboardProps, 'project'>
  >(
    () => ({
      ...hostProps,
      backendUrl: normalizeBackendUrl(hostProps.backendUrl),
    }),
    [
      hostProps.backendUrl,
      hostProps.mode,
      hostProps.showNavbar,
      hostProps.onNavigateToSubscription,
      hostProps.onRenameProject,
      hostProps.onDeleteProject,
      hostProps.onRequestInstanceInfo,
      hostProps.onRequestInstanceTypeChange,
      hostProps.onUpdateVersion,
      hostProps.mode === 'cloud-hosting' ? hostProps.getAuthorizationCode : undefined,
    ]
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
            <DashboardProjectProvider value={project}>
              <AuthProvider>
                <SocketProvider>
                  <ToastProvider>
                    <PostHogAnalyticsProvider>
                      <SQLEditorProvider>
                        <AppRoutes />
                      </SQLEditorProvider>
                    </PostHogAnalyticsProvider>
                  </ToastProvider>
                </SocketProvider>
              </AuthProvider>
            </DashboardProjectProvider>
          </DashboardHostProvider>
        </QueryClientProvider>
      </BrowserRouter>
    </div>
  );
}
