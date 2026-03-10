import React, { useEffect, useState } from 'react';
import AppSidebar from './AppSidebar';
import AppHeader from './AppHeader';
import { ThemeProvider } from '@/lib/contexts/ThemeContext';
import { ConnectDialog } from '@/features/connect';
import { SettingsMenuDialog } from '@/features/dashboard/components';
import { isIframe } from '@/lib/utils/utils';

interface LayoutProps {
  children: React.ReactNode;
}

const SIDEBAR_AUTO_COLLAPSE_BREAKPOINT = '(max-width: 1023px)';

export default function Layout({ children }: LayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.matchMedia(SIDEBAR_AUTO_COLLAPSE_BREAKPOINT).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const mediaQuery = window.matchMedia(SIDEBAR_AUTO_COLLAPSE_BREAKPOINT);
    const handleBreakpointChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setSidebarCollapsed(true);
      }
    };

    if (mediaQuery.matches) {
      setSidebarCollapsed(true);
    }

    mediaQuery.addEventListener('change', handleBreakpointChange);

    return () => {
      mediaQuery.removeEventListener('change', handleBreakpointChange);
    };
  }, []);

  const handleToggleCollapse = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  return (
    <ThemeProvider forcedTheme={isIframe() ? 'dark' : undefined}>
      <div className="h-screen bg-gray-50 dark:bg-neutral-800 flex flex-col">
        {!isIframe() && <AppHeader />}

        {/* Main layout - sidebars + content in flexbox */}
        <div className="flex-1 flex overflow-hidden">
          <AppSidebar isCollapsed={sidebarCollapsed} onToggleCollapse={handleToggleCollapse} />
          <main className="flex-1 overflow-y-auto relative">{children}</main>
        </div>
      </div>
      <ConnectDialog />
      <SettingsMenuDialog />
    </ThemeProvider>
  );
}
