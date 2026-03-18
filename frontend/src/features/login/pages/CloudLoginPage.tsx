import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { LockIcon } from 'lucide-react';
import { useAuth } from '@/lib/contexts/AuthContext';
import { postMessageToParent } from '@/lib/utils/cloudMessaging';
import { isInsForgeCloudProject, isIframe } from '@/lib/utils/utils';

export default function CloudLoginPage() {
  const navigate = useNavigate();
  const { isAuthenticated, error } = useAuth();
  const hasRequestedAuthRef = useRef(false);

  useEffect(() => {
    if (
      hasRequestedAuthRef.current ||
      isAuthenticated ||
      error ||
      !isInsForgeCloudProject() ||
      !isIframe()
    ) {
      return;
    }

    hasRequestedAuthRef.current = true;
    postMessageToParent({ type: 'REQUEST_AUTHORIZATION_CODE' });
  }, [isAuthenticated, error]);

  useEffect(() => {
    if (isAuthenticated) {
      void navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // Show error state if authentication failed
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center text-gray-900">
          <LockIcon className="h-12 w-12 mx-auto mb-4 text-red-600" />
          <h2 className="text-xl font-semibold mb-2">Authentication Failed</h2>
          <p className="text-gray-600 text-sm max-w-md">{error.message}</p>
        </div>
      </div>
    );
  }

  // Show authenticating state
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="text-center">
        <div className="animate-spin mb-4">
          <LockIcon className="h-12 w-12 text-gray-900 mx-auto" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Authenticating...</h2>
        <p className="text-sm text-gray-600">Please wait while we verify your identity</p>
      </div>
    </div>
  );
}
