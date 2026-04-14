import { useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, useNavigate } from 'react-router-dom';
import { AuthProvider } from '../lib/contexts/AuthContext';
import { AppRoutes } from '../router/AppRoutes';
import { ToastProvider } from '../lib/hooks/useToast';
import { SocketProvider } from '../lib/contexts/SocketContext';
import { PostHogAnalyticsProvider } from '../lib/analytics/posthog';
import { SQLEditorProvider } from '../features/database/contexts/SQLEditorContext';
import {
  DashboardHostProvider,
  DashboardProjectProvider,
} from '../lib/config/DashboardHostContext';
import { setDashboardBackendUrl } from '../lib/config/runtime';
import type { InsForgeDashboardProps } from '../types';

function InitialRouteNavigator({ route }: { route?: string | null }) {
  const navigate = useNavigate();
  const hasNavigated = useRef(false);

  useEffect(() => {
    if (route && !hasNavigated.current) {
      hasNavigated.current = true;
      void navigate(route, { replace: true });
    }
  }, [route, navigate]);

  return null;
}

function normalizeBackendUrl(url?: string) {
  return url?.replace(/\/$/, '') || undefined;
}

export function InsForgeDashboard(props: InsForgeDashboardProps) {
  const {
    project,
    backendUrl,
    mode,
    showNavbar,
    initialRoute,
    onRouteChange,
    onNavigateToSubscription,
    onRenameProject,
    onDeleteProject,
    onRequestInstanceInfo,
    onRequestInstanceTypeChange,
    onUpdateVersion,
  } = props;
  const getAuthorizationCode =
    props.mode === 'cloud-hosting' ? props.getAuthorizationCode : undefined;
  const host = useMemo(
    () => ({
      backendUrl: normalizeBackendUrl(backendUrl),
      mode,
      showNavbar,
      getAuthorizationCode,
      onRouteChange,
      onNavigateToSubscription,
      onRenameProject,
      onDeleteProject,
      onRequestInstanceInfo,
      onRequestInstanceTypeChange,
      onUpdateVersion,
    }),
    [
      backendUrl,
      mode,
      showNavbar,
      getAuthorizationCode,
      onRouteChange,
      onNavigateToSubscription,
      onRenameProject,
      onDeleteProject,
      onRequestInstanceInfo,
      onRequestInstanceTypeChange,
      onUpdateVersion,
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
        <InitialRouteNavigator route={initialRoute} />
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
