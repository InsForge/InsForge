import React, { useState, useEffect } from 'react';
import AppSidebar from './AppSidebar';
import AppHeader from './AppHeader';
import { useAuth } from '@/lib/contexts/AuthContext';
import { ThemeProvider } from '@/lib/contexts/ThemeContext';
import { isIframe } from '@/lib/utils/utils';
import { useMediaQuery } from '@/lib/hooks/useMediaQuery';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuth();
  const isLargeScreen = useMediaQuery('(min-width: 1536px)'); // 2xl breakpoint

  // Default to collapsed on small screens, expanded on large screens
  const [sidebarCollapsed, setSidebarCollapsed] = useState(!isLargeScreen);

  // Update collapsed state when screen size changes (only if user hasn't manually toggled)
  useEffect(() => {
    setSidebarCollapsed(!isLargeScreen);
  }, [isLargeScreen]);

  const handleToggleCollapse = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  return (
    <ThemeProvider forcedTheme={isIframe() ? 'dark' : undefined}>
      <div className="h-screen bg-gray-50 dark:bg-neutral-800 flex flex-col">
        {!isIframe() && <AppHeader currentUser={user} onLogout={logout} />}

        {/* Main layout - sidebars + content in flexbox */}
        <div className="flex-1 flex overflow-hidden">
          <AppSidebar isCollapsed={sidebarCollapsed} onToggleCollapse={handleToggleCollapse} />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </ThemeProvider>
  );
}
