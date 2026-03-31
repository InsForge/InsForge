import { useState, type ReactNode } from 'react';

export interface DashboardFrameRenderProps {
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export interface DashboardFrameProps {
  showHeader?: boolean;
  header?: ReactNode;
  sidebar: (props: DashboardFrameRenderProps) => ReactNode;
  children: ReactNode;
  overlays?: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function DashboardFrame({
  showHeader = true,
  header,
  sidebar,
  children,
  overlays,
  className = 'h-screen bg-gray-50 dark:bg-neutral-800 flex flex-col',
  contentClassName = 'flex-1 flex overflow-hidden',
}: DashboardFrameProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const toggleSidebar = () => {
    setIsSidebarCollapsed((previous) => !previous);
  };

  return (
    <>
      <div className={className}>
        {showHeader ? header : null}
        <div className={contentClassName}>
          {sidebar({ isSidebarCollapsed, toggleSidebar })}
          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
      {overlays}
    </>
  );
}
