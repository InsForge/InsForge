import { useState, type ReactNode } from 'react';
import AppSidebar from './AppSidebar';
import AppHeader from './AppHeader';
import { ThemeProvider } from '../lib/contexts/ThemeContext';
import { useDashboardHost } from '../lib/config/DashboardHostContext';
import { ConnectDialog } from '../features/dashboard/components/connect';
import { ProjectSettingsMenuDialog } from '../features/dashboard/components';
import { cn } from '../lib/utils/utils';

interface LayoutProps {
  children: ReactNode;
}

export default function AppLayout({ children }: LayoutProps) {
  const host = useDashboardHost();
  const isContainedHostLayout = host.mode === 'cloud-hosting';
  const showNavbar = host.showNavbar ?? true;
  const forcedTheme = host.mode === 'cloud-hosting' ? 'dark' : undefined;
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const toggleSidebar = () => {
    setIsSidebarCollapsed((previous) => !previous);
  };

  return (
    <ThemeProvider forcedTheme={forcedTheme}>
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
      <ConnectDialog />
      <ProjectSettingsMenuDialog />
    </ThemeProvider>
  );
}
