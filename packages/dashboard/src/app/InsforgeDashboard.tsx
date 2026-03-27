import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { DashboardProviders } from './DashboardProviders';
import { DashboardAppShell } from './DashboardAppShell';
import { createDashboardQueryClient } from './createDashboardQueryClient';
import { DashboardRouter } from '../router/DashboardRouter';
import { AuthProvider } from '../lib/contexts/AuthContext';
import { AppRoutes } from '../lib/routing/AppRoutes';
import { ToastProvider } from '../lib/hooks/useToast';
import { SocketProvider } from '../lib/contexts/SocketContext';
import { PostHogAnalyticsProvider } from '../lib/analytics/posthog';
import { ModalProvider } from '../lib/contexts/ModalContext';
import { SQLEditorProvider } from '../features/database/contexts/SQLEditorContext';
import type {
  CloudHostingDashboardProps,
  DashboardMode,
  DashboardProps,
  SelfHostingDashboardProps,
} from '../types';

function useDashboardStyles(mode: DashboardMode) {
  useEffect(() => {
    if (mode === 'cloud-hosting') {
      void import('../styles/index.css');
    }
  }, [mode]);
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
                <ModalProvider>
                  <SQLEditorProvider>
                    <AppRoutes />
                  </SQLEditorProvider>
                </ModalProvider>
              </PostHogAnalyticsProvider>
            </ToastProvider>
          </SocketProvider>
        </AuthProvider>
      </DashboardAppShell>
    </BrowserRouter>
  );
}

function CloudHostingDashboard(props: CloudHostingDashboardProps) {
  const [queryClient] = useState(() => createDashboardQueryClient());

  return (
    <div className="if-dashboard">
      <DashboardProviders queryClient={queryClient} host={props}>
        <DashboardRouter />
      </DashboardProviders>
    </div>
  );
}

export function InsForgeDashboard(props: DashboardProps) {
  useDashboardStyles(props.mode);

  if (props.mode === 'self-hosting') {
    return <SelfHostingDashboard {...props} />;
  }

  return <CloudHostingDashboard {...props} />;
}
