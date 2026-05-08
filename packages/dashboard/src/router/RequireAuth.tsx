import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '#lib/contexts/AuthContext';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { LoadingState } from '#components/LoadingState';

interface RequireAuthProps {
  children: ReactNode;
}

export const RequireAuth = ({ children }: RequireAuthProps) => {
  const { isAuthenticated, isLoading } = useAuth();
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
    return <Navigate to={isCloudHosting ? '/cloud/login' : '/dashboard/login'} replace />;
  }

  return <>{children}</>;
};
