import React from 'react';
import { DashboardFrame } from '../../layout/DashboardFrame';
import AppSidebar from './AppSidebar';
import AppHeader from './AppHeader';
import { ThemeProvider } from '../../lib/contexts/ThemeContext';
import { useDashboardHost } from '../../lib/config/DashboardHostContext';
import { ConnectDialog } from '../../features/dashboard/components/connect';
import { ProjectSettingsMenuDialog } from '../../features/dashboard/components';
import { cn } from '../../lib/utils/utils';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const host = useDashboardHost();
  const isContainedHostLayout = host.mode === 'cloud-hosting';
  const showNavbar = host.showNavbar ?? true;
  const forcedTheme = host.mode === 'cloud-hosting' ? 'dark' : undefined;

  return (
    <ThemeProvider forcedTheme={forcedTheme}>
      <DashboardFrame
        showHeader={showNavbar}
        header={<AppHeader />}
        className={cn(
          'min-h-0 min-w-0 bg-semantic-0 flex flex-col',
          isContainedHostLayout ? 'h-full' : 'h-screen'
        )}
        contentClassName="min-h-0 min-w-0 flex-1 flex overflow-hidden"
        sidebar={({ isSidebarCollapsed, toggleSidebar }) => (
          <AppSidebar isCollapsed={isSidebarCollapsed} onToggleCollapse={toggleSidebar} />
        )}
        overlays={
          <>
            <ConnectDialog />
            <ProjectSettingsMenuDialog />
          </>
        }
      >
        {children}
      </DashboardFrame>
    </ThemeProvider>
  );
}
