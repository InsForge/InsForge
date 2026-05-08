import { useEffect, useRef } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Button } from '@insforge/ui';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { useAuth } from '#lib/contexts/AuthContext';
import { getFeatureFlag } from '#lib/analytics/posthog';
import { useMcpUsage } from '#features/logs/hooks/useMcpUsage';

export default function CloudLoginPage() {
  const navigate = useNavigate();
  const host = useDashboardHost();
  const { isAuthenticated, isLoading, error, refreshAuth } = useAuth();
  const { hasCompletedOnboarding, isLoading: isMcpUsageLoading } = useMcpUsage();
  const hasRequestedAuthRef = useRef(false);
  const isCloudHosting = host.mode === 'cloud-hosting';
  const isDTest = getFeatureFlag('dashboard-v4-experiment') === 'd_test';

  useEffect(() => {
    if (!isCloudHosting || hasRequestedAuthRef.current || isAuthenticated || isLoading || error) {
      return;
    }

    hasRequestedAuthRef.current = true;
    void refreshAuth();
  }, [error, isAuthenticated, isCloudHosting, isLoading, refreshAuth]);

  useEffect(() => {
    if (!isCloudHosting || !isAuthenticated) {
      return;
    }

    if (isDTest && isMcpUsageLoading) {
      return;
    }
    const target = isDTest && !hasCompletedOnboarding ? '/dashboard/install' : '/dashboard';
    void navigate(target, { replace: true });
  }, [
    isAuthenticated,
    isCloudHosting,
    isDTest,
    hasCompletedOnboarding,
    isMcpUsageLoading,
    navigate,
  ]);

  if (!isCloudHosting) {
    return <Navigate to="/dashboard/login" replace />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-neutral-800 flex items-center justify-center px-4">
        <div className="text-center text-white max-w-md">
          <Lock className="h-12 w-12 mx-auto mb-4 text-red-400" />
          <h2 className="text-xl font-semibold mb-2">Authentication Failed</h2>
          <p className="text-gray-400 text-sm">{error.message}</p>
          <Button
            className="mt-6"
            onClick={() => {
              void refreshAuth();
            }}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-800 flex items-center justify-center px-4">
      <div className="text-center">
        {isLoading ? (
          <div className="animate-spin mb-4">
            <Lock className="h-12 w-12 text-white mx-auto" />
          </div>
        ) : (
          <Lock className="h-12 w-12 text-white mx-auto mb-4" />
        )}
        <h2 className="text-xl font-semibold text-white mb-2">
          {isLoading ? 'Authenticating...' : 'Preparing dashboard...'}
        </h2>
        <p className="text-sm text-gray-400">Please wait while we verify your identity</p>
      </div>
    </div>
  );
}
