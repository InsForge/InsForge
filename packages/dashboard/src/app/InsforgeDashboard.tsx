import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { DashboardProviders } from './DashboardProviders';
import { DashboardAppShell } from './DashboardAppShell';
import { createDashboardQueryClient } from './createDashboardQueryClient';
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
  DashboardMode,
  DashboardProps,
  SelfHostingDashboardProps,
} from '../types';

function useDashboardStyles(mode: DashboardMode) {
  useEffect(() => {
    if (mode === 'cloud-hosting') {
      void import('../styles/cloud-hosting.css');
    }
  }, [mode]);
}

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
  return (
    <div className="if-dashboard h-full">
      <MemoryRouter initialEntries={[props.initialPath || '/dashboard']}>
        <DashboardAppShell {...props}>
          <RouteChangeNotifier />
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
      </MemoryRouter>
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
