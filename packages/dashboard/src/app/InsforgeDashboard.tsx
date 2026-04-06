import { useEffect, useMemo } from 'react';
import { BrowserRouter, MemoryRouter, useLocation } from 'react-router-dom';
import { DashboardAppShell } from './DashboardAppShell';
import { AuthProvider } from '../lib/contexts/AuthContext';
import { AppRoutes } from '../lib/routing/AppRoutes';
import { ToastProvider } from '../lib/hooks/useToast';
import { SocketProvider } from '../lib/contexts/SocketContext';
import { PostHogAnalyticsProvider } from '../lib/analytics/posthog';
import { ModalProvider } from '../lib/contexts/ModalContext';
import { SQLEditorProvider } from '../features/database/contexts/SQLEditorContext';
import { useDashboardHost } from '../lib/config/DashboardHostContext';
import type {
  CloudHostingDashboardProps,
  DashboardProps,
  SelfHostingDashboardProps,
} from '../types';

function RouteChangeNotifier() {
  const location = useLocation();
  const host = useDashboardHost();

  useEffect(() => {
    host.onRouteChange?.({
      path: `${location.pathname}${location.search}${location.hash}`,
    });
  }, [host, location.hash, location.pathname, location.search]);

  return null;
}

function SelfHostingDashboard({
  backendUrl,
  initialPath = '/dashboard',
  auth,
  ...host
}: SelfHostingDashboardProps) {
  const normalizedBackendUrl = useMemo(() => backendUrl.replace(/\/$/, ''), [backendUrl]);

  return (
    <BrowserRouter>
      <div className="insforge-dashboard flex h-full min-h-0 min-w-0 flex-col">
        <DashboardAppShell
          {...host}
          mode="self-hosting"
          backendUrl={normalizedBackendUrl}
          initialPath={initialPath}
          auth={auth ?? { strategy: 'session' }}
        >
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
        </DashboardAppShell>
      </div>
    </BrowserRouter>
  );
}

function CloudHostingDashboard(props: CloudHostingDashboardProps) {
  return (
    <div className="insforge-dashboard flex h-full min-h-0 min-w-0 flex-col">
      <MemoryRouter initialEntries={[props.initialPath || '/dashboard']}>
        <DashboardAppShell {...props}>
          <RouteChangeNotifier />
          <AuthProvider>
            <SocketProvider>
              <ToastProvider>
                <PostHogAnalyticsProvider>
                  <ModalProvider
                    connectDialogOpen={props.connectDialogOpen}
                    onConnectDialogOpenChange={props.onConnectDialogOpenChange}
                  >
                    <SQLEditorProvider>
                      <AppRoutes />
                    </SQLEditorProvider>
                  </ModalProvider>
                </PostHogAnalyticsProvider>
              </ToastProvider>
            </SocketProvider>
          </AuthProvider>
        </DashboardAppShell>
      </MemoryRouter>
    </div>
  );
}

export function InsForgeDashboard(props: DashboardProps) {
  if (props.mode === 'self-hosting') {
    return <SelfHostingDashboard {...props} />;
  }

  return <CloudHostingDashboard {...props} />;
}
