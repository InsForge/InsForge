import { useMemo } from 'react';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { DashboardProviders } from './DashboardProviders';
import { AuthProvider } from '../lib/contexts/AuthContext';
import { AppRoutes } from '../lib/routing/AppRoutes';
import { ToastProvider } from '../lib/hooks/useToast';
import { SocketProvider } from '../lib/contexts/SocketContext';
import { PostHogAnalyticsProvider } from '../lib/analytics/posthog';
import { ModalProvider } from '../lib/contexts/ModalContext';
import { SQLEditorProvider } from '../features/database/contexts/SQLEditorContext';
import type {
  CloudHostingDashboardProps,
  DashboardProps,
  SelfHostingDashboardProps,
} from '../types';

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
        <DashboardProviders
          host={{
            ...host,
            mode: 'self-hosting',
            backendUrl: normalizedBackendUrl,
            initialPath,
            auth: auth ?? { strategy: 'session' },
          }}
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
        </DashboardProviders>
      </div>
    </BrowserRouter>
  );
}

function CloudHostingDashboard(props: CloudHostingDashboardProps) {
  return (
    <div className="insforge-dashboard flex h-full min-h-0 min-w-0 flex-col">
      <MemoryRouter initialEntries={[props.initialPath || '/dashboard']}>
        <DashboardProviders host={props}>
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
        </DashboardProviders>
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
