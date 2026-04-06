import { ReactNode } from 'react';
import { DASHBOARD_LOGIN_PATH } from './paths';
import { DashboardProtectedBoundary } from './DashboardProtectedBoundary';
import { useAuth } from '../lib/contexts/AuthContext';
import { LoadingState } from '../components/LoadingState';

interface RequireAuthProps {
  children: ReactNode;
}

export const RequireAuth = ({ children }: RequireAuthProps) => {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <DashboardProtectedBoundary
      isAuthenticated={isAuthenticated}
      isLoading={isLoading}
      unauthenticatedRedirectPath={DASHBOARD_LOGIN_PATH}
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
