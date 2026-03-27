import { useState, type PropsWithChildren } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { DashboardProviders } from './DashboardProviders';
import { createDashboardQueryClient } from './createDashboardQueryClient';
import type { DashboardProps } from '../types';

export type DashboardAppShellProps = PropsWithChildren<DashboardProps> & {
  queryClient?: QueryClient;
};

export function DashboardAppShell({ children, queryClient, ...host }: DashboardAppShellProps) {
  const [localQueryClient] = useState(() => queryClient ?? createDashboardQueryClient());

  return (
    <DashboardProviders queryClient={localQueryClient} host={host}>
      {children}
    </DashboardProviders>
  );
}
