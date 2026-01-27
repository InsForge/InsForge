import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LockIcon } from 'lucide-react';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useMcpUsage } from '@/features/logs/hooks/useMcpUsage';

export default function CloudLoginPage() {
  const navigate = useNavigate();
  const { isAuthenticated, error } = useAuth();
  const { isLoading: isMcpUsageLoading } = useMcpUsage();

  useEffect(() => {
    if (isAuthenticated && !isMcpUsageLoading) {
      void navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, isMcpUsageLoading, navigate]);

  // Show error state if authentication failed
  if (error) {
    return (
      <div className="min-h-screen bg-neutral-800 flex items-center justify-center px-4">
        <div className="text-center text-white">
          <LockIcon className="h-12 w-12 mx-auto mb-4 text-red-400" />
          <h2 className="text-xl font-semibold mb-2">Authentication Failed</h2>
          <p className="text-gray-400 text-sm max-w-md">{error.message}</p>
        </div>
      </div>
    );
  }

  // Show authenticating state
  return (
    <div className="min-h-screen bg-neutral-800 flex items-center justify-center px-4">
      <div className="text-center">
        <div className="animate-spin mb-4">
          <LockIcon className="h-12 w-12 text-white mx-auto" />
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">Authenticating...</h2>
        <p className="text-sm text-gray-400">Please wait while we verify your identity</p>
      </div>
    </div>
  );
}
