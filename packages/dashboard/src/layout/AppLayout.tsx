import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AppSidebar from './AppSidebar';
import AppHeader from './AppHeader';
import { ThemeProvider } from '#lib/contexts/ThemeContext';
import { LocaleProvider } from '#lib/contexts/LocaleContext';
import { ConnectDialog } from '#features/dashboard/components/connect';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { cn } from '@insforge/ui';
import { ConnectDialogProvider } from './ConnectDialogContext';
import { useFeatureFlag, useFeatureFlagsReady } from '#lib/analytics/posthog';
import { FEATURE_FLAGS, FEATURE_FLAG_VARIANTS } from '#lib/analytics/constants';
import { DTestConnectTip } from '#features/dashboard/components/dtest/DTestConnectTip';

const CONNECT_DIALOG_MESSAGE_TYPES = new Set(['SHOW_ONBOARDING_OVERLAY', 'SHOW_CONNECT_OVERLAY']);

interface ConnectOverlayBridgeProps {
  hostMode: string;
  onOpenDialog: () => void;
}

function ConnectOverlayBridge({ hostMode, onOpenDialog }: ConnectOverlayBridgeProps) {
  const navigate = useNavigate();
  const flagsReady = useFeatureFlagsReady();
  const dashboardVariant = useFeatureFlag(FEATURE_FLAGS.DASHBOARD_V4_EXPERIMENT);
  // Parent can post the connect message before /decide returns. Hold it and
  // replay once we know which shell the user is in, otherwise a D_TEST user
  // gets the legacy dialog and never recovers.
  const pendingConnectRef = useRef(false);

  const openConnect = useCallback(() => {
    if (dashboardVariant === FEATURE_FLAG_VARIANTS.D_TEST) {
      void navigate('/dashboard/install');
    } else {
      onOpenDialog();
    }
  }, [dashboardVariant, navigate, onOpenDialog]);

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

      if (!flagsReady) {
        pendingConnectRef.current = true;
        return;
      }

      openConnect();
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [hostMode, flagsReady, openConnect]);

  useEffect(() => {
    if (!flagsReady || !pendingConnectRef.current) {
      return;
    }
    pendingConnectRef.current = false;
    openConnect();
  }, [flagsReady, openConnect]);

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
  const location = useLocation();
  const isContainedHostLayout = host.mode === 'cloud-hosting';
  const showNavbar = host.showNavbar ?? true;
  const forcedTheme = host.mode === 'cloud-hosting' ? 'dark' : undefined;
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
      <LocaleProvider>
        <ConnectDialogProvider value={openConnectDialog}>
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
                {children}
              </main>
            </div>
          </div>
          <ConnectDialog open={isConnectDialogOpen} onOpenChange={setIsConnectDialogOpen} />
        </ConnectDialogProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
