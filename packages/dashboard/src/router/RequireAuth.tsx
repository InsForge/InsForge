import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { DASHBOARD_LOGIN_PATH } from './paths';
import { useAuth } from '../lib/contexts/AuthContext';
import { useDashboardHost } from '../lib/config/DashboardHostContext';
import { LoadingState } from '../components/LoadingState';

interface RequireAuthProps {
  children: ReactNode;
}

export const RequireAuth = ({ children }: RequireAuthProps) => {
  const { isAuthenticated, isLoading, error } = useAuth();
  const host = useDashboardHost();
  const isCloudHosting = host.mode === 'cloud-hosting';

  const loadingFallback = (
    <div
      className={`flex min-h-screen items-center justify-center ${isCloudHosting ? 'bg-neutral-950' : 'bg-semantic-1 text-foreground'}`}
    >
      <LoadingState className="py-0" />
    </div>
  );

  if (isLoading) {
    return loadingFallback;
  }

  if (!isAuthenticated) {
    // In cloud-hosting mode, stay on a loading screen while auth resolves
    // instead of flashing the login page — the user never enters credentials.
    if (isCloudHosting && !error) {
      return loadingFallback;
    }

    return <Navigate to={DASHBOARD_LOGIN_PATH} replace />;
  }

  return <>{children}</>;
};
