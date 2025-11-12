import React, { useState } from 'react';
import AppSidebar from './AppSidebar';
import AppHeader from './AppHeader';
import { useAuth } from '@/lib/contexts/AuthContext';
import { ThemeProvider } from '@/lib/contexts/ThemeContext';
import { isIframe } from '@/lib/utils/utils';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
