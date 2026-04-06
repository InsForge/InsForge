import { ReactNode } from 'react';
import { CLOUD_LOGIN_PATH, DASHBOARD_LOGIN_PATH } from './paths';
import { DashboardProtectedBoundary } from './DashboardProtectedBoundary';
import { useDashboardHost } from '../lib/config/DashboardHostContext';
import { useAuth } from '../lib/contexts/AuthContext';
import { LoadingState } from '../components/LoadingState';

interface RequireAuthProps {
  children: ReactNode;
}

export const RequireAuth = ({ children }: RequireAuthProps) => {
  const host = useDashboardHost();
  const { isAuthenticated, isLoading } = useAuth();
  const shouldUseCloudLogin = host.mode === 'cloud-hosting';

  return (
    <DashboardProtectedBoundary
      isAuthenticated={isAuthenticated}
      isLoading={isLoading}
      unauthenticatedRedirectPath={shouldUseCloudLogin ? CLOUD_LOGIN_PATH : DASHBOARD_LOGIN_PATH}
      loadingFallback={
        <div className="flex min-h-screen items-center justify-center bg-semantic-1 text-foreground">
          <LoadingState className="py-0" />
        </div>
      }
    >
      {children}
    </DashboardProtectedBoundary>
  );
};
