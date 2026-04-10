import { useCallback, useEffect, useState, type ReactNode } from 'react';
import AppSidebar from './AppSidebar';
import AppHeader from './AppHeader';
import { ThemeProvider } from '../lib/contexts/ThemeContext';
import { useDashboardHost } from '../lib/config/DashboardHostContext';
import { ConnectDialog } from '../features/dashboard/components/connect';
import { cn } from '../lib/utils/utils';
import { ConnectDialogProvider } from './ConnectDialogContext';

const CONNECT_DIALOG_MESSAGE_TYPES = new Set(['SHOW_ONBOARDING_OVERLAY', 'SHOW_CONNECT_OVERLAY']);

interface LayoutProps {
  children: ReactNode;
}

export default function AppLayout({ children }: LayoutProps) {
  const host = useDashboardHost();
  const isContainedHostLayout = host.mode === 'cloud-hosting';
  const showNavbar = host.showNavbar ?? true;
  const forcedTheme = host.mode === 'cloud-hosting' ? 'dark' : undefined;
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false);

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

    const parentWindow = typeof window !== 'undefined' ? window.parent : null;
    const openerWindow = typeof window !== 'undefined' ? window.opener : null;

    const handleMessage = (event: MessageEvent<{ type?: string }>) => {
      const isParentMessage = event.source === parentWindow;
      const isOpenerMessage = openerWindow !== null && event.source === openerWindow;
      if (!isParentMessage && !isOpenerMessage) {
        return;
      }

      const messageType = event.data?.type;
      if (messageType && CONNECT_DIALOG_MESSAGE_TYPES.has(messageType)) {
        setIsConnectDialogOpen(true);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [host.mode]);

  return (
    <ThemeProvider forcedTheme={forcedTheme}>
      <ConnectDialogProvider value={openConnectDialog}>
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
    </ThemeProvider>
  );
}
