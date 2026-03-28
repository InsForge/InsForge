import type { ReactNode } from 'react';

export interface DashboardSectionLayoutProps {
  sidebar?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function DashboardSectionLayout({
  sidebar,
  children,
  className = 'flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]',
}: DashboardSectionLayoutProps) {
  return (
    <div className={className}>
      {sidebar}
      <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
