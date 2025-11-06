import React from 'react';
import AppSidebar from './AppSidebar';
import AppHeader from './AppHeader';
import { useAuth } from '@/lib/contexts/AuthContext';
import { ThemeProvider } from '@/lib/contexts/ThemeContext';
import { isInsForgeCloudProject } from '@/lib/utils/utils';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuth();

  return (
    <ThemeProvider forcedTheme={isInsForgeCloudProject() ? 'dark' : undefined}>
      <div className="h-screen bg-gray-50 dark:bg-neutral-800 flex flex-col">
        {!isInsForgeCloudProject() && <AppHeader currentUser={user} onLogout={logout} />}

        {/* Main layout - sidebars + content in flexbox */}
        <div className="flex-1 flex overflow-hidden">
          <AppSidebar onLogout={logout} />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </ThemeProvider>
  );
}
