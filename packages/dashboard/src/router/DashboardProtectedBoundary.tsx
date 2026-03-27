import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

export interface DashboardProtectedBoundaryProps {
  isAuthenticated: boolean;
  isLoading: boolean;
  loadingFallback?: ReactNode;
  unauthenticatedRedirectPath: string;
  children: ReactNode;
}

export function DashboardProtectedBoundary({
  isAuthenticated,
  isLoading,
  loadingFallback = null,
  unauthenticatedRedirectPath,
  children,
}: DashboardProtectedBoundaryProps) {
  if (isLoading) {
    return <>{loadingFallback}</>;
  }

  if (!isAuthenticated) {
    return <Navigate to={unauthenticatedRedirectPath} replace />;
  }

  return <>{children}</>;
}
