import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import AppSidebar from './AppSidebar';
import AppHeader from './AppHeader';
import { ThemeProvider } from '../lib/contexts/ThemeContext';
import { ConnectDialog } from '../features/dashboard/components/connect';
import { ConnectDialogV2 } from '../features/dashboard/components/connect/ConnectDialogV2';
import { ProjectRestoringPage } from '../features/dashboard/components/ProjectRestoringPage';
import { useDashboardHost, useDashboardProject } from '../lib/config/DashboardHostContext';
import { cn } from '../lib/utils/utils';
import { ConnectDialogProvider } from './ConnectDialogContext';
import { getFeatureFlag } from '../lib/analytics/posthog';
import {
  DTestViewProvider,
  useDTestView,
} from '../features/dashboard/components/dtest/DTestViewContext';
import { DTestConnectTip } from '../features/dashboard/components/dtest/DTestConnectTip';

const CONNECT_DIALOG_MESSAGE_TYPES = new Set(['SHOW_ONBOARDING_OVERLAY', 'SHOW_CONNECT_OVERLAY']);

interface ConnectOverlayBridgeProps {
  hostMode: string;
  onOpenDialog: () => void;
}

function ConnectOverlayBridge({ hostMode, onOpenDialog }: ConnectOverlayBridgeProps) {
  const { setView } = useDTestView();

  useEffect(() => {
    if (hostMode !== 'cloud-hosting') {
      return;
    }

    const parentWindow = typeof window !== 'undefined' ? window.parent : null;
    const openerWindow = typeof window !== 'undefined' ? window.opener : null;

    const handleMessage = (event: MessageEvent<{ type?: string; path?: unknown }>) => {
      const isParentMessage = event.source === parentWindow;
      const isOpenerMessage = openerWindow !== null && event.source === openerWindow;
      if (!isParentMessage && !isOpenerMessage) {
        return;
      }

      const messageType = event.data?.type;
      if (!messageType || !CONNECT_DIALOG_MESSAGE_TYPES.has(messageType)) {
        return;
      }

      if (getFeatureFlag('dashboard-v4-experiment') === 'd_test') {
        setView('install');
      } else {
        onOpenDialog();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [hostMode, setView, onOpenDialog]);

  return null;
}

function getEmbeddedDashboardRoute(path: string): string | null {
  if (path.startsWith('/dashboard')) {
    return path;
  }

  return null;
}

interface LayoutProps {
  children: ReactNode;
}

export default function AppLayout({ children }: LayoutProps) {
  const host = useDashboardHost();
  const project = useDashboardProject();
  const location = useLocation();
  const isContainedHostLayout = host.mode === 'cloud-hosting';
  const showNavbar = host.showNavbar ?? true;
  const forcedTheme = host.mode === 'cloud-hosting' ? 'dark' : undefined;
  const showProjectRestoringPage = host.mode === 'cloud-hosting' && project?.status === 'restoring';
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false);
  const currentRoute = `${location.pathname}${location.search}${location.hash}`;

  const toggleSidebar = () => {
    setIsSidebarCollapsed((previous) => !previous);
  };

  const openConnectDialog = useCallback(() => {
    setIsConnectDialogOpen(true);
  }, []);

  useEffect(() => {
    if (host.mode !== 'cloud-hosting') {
      return;
    }

    const embeddedRoute = getEmbeddedDashboardRoute(currentRoute);
    if (!embeddedRoute) {
      return;
    }

    host.onRouteChange?.(embeddedRoute);
  }, [currentRoute, host]);

  return (
    <ThemeProvider forcedTheme={forcedTheme}>
      <ConnectDialogProvider value={openConnectDialog}>
        <DTestViewProvider>
          <ConnectOverlayBridge hostMode={host.mode} onOpenDialog={openConnectDialog} />
          <DTestConnectTip />
          <div
            className={cn(
              'min-h-0 min-w-0 bg-semantic-0 flex flex-col',
              isContainedHostLayout ? 'h-full' : 'h-screen'
            )}
          >
            {showNavbar ? <AppHeader /> : null}
            <div className="min-h-0 min-w-0 flex flex-1 overflow-hidden">
              <AppSidebar isCollapsed={isSidebarCollapsed} onToggleCollapse={toggleSidebar} />
              <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
                {showProjectRestoringPage ? <ProjectRestoringPage /> : children}
              </main>
            </div>
          </div>
          {getFeatureFlag('dashboard-v4-experiment') === 'c_test' ? (
            <ConnectDialogV2 open={isConnectDialogOpen} onOpenChange={setIsConnectDialogOpen} />
          ) : (
            <ConnectDialog open={isConnectDialogOpen} onOpenChange={setIsConnectDialogOpen} />
          )}
        </DTestViewProvider>
      </ConnectDialogProvider>
    </ThemeProvider>
  );
}
