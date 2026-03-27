import React from 'react';
import { DashboardFrame } from '../../layout/DashboardFrame';
import AppSidebar from './AppSidebar';
import AppHeader from './AppHeader';
import { ThemeProvider } from '../../lib/contexts/ThemeContext';
import { ConnectDialog } from '../../features/dashboard/components/connect';
import { ProjectSettingsMenuDialog } from '../../features/dashboard/components';
import { isIframe } from '../../lib/utils/utils';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <ThemeProvider forcedTheme={isIframe() ? 'dark' : undefined}>
      <DashboardFrame
        showHeader={!isIframe()}
        header={<AppHeader />}
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
