import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/contexts/AuthContext';
import { LoadingState } from '@/components/LoadingState';
import { isInsForgeCloudProject } from '../utils/utils';

interface RequireAuthProps {
  children: ReactNode;
}

export const RequireAuth = ({ children }: RequireAuthProps) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={isInsForgeCloudProject() ? '/cloud/login' : '/dashboard/login'} replace />;
  }

  return <>{children}</>;
};
