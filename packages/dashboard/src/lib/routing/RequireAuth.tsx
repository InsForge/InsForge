import { ReactNode } from 'react';
import { CLOUD_LOGIN_PATH, DASHBOARD_LOGIN_PATH, DashboardProtectedBoundary } from '../../router';
import { useAuth } from '../contexts/AuthContext';
import { LoadingState } from '../../components/LoadingState';
import { isIframe } from '../utils/utils';

interface RequireAuthProps {
  children: ReactNode;
}

export const RequireAuth = ({ children }: RequireAuthProps) => {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <DashboardProtectedBoundary
      isAuthenticated={isAuthenticated}
      isLoading={isLoading}
      unauthenticatedRedirectPath={isIframe() ? CLOUD_LOGIN_PATH : DASHBOARD_LOGIN_PATH}
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
