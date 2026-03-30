import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LockIcon } from 'lucide-react';
import { useDashboardHost } from '../../../lib/config/DashboardHostContext';
import { useAuth } from '../../../lib/contexts/AuthContext';
import { postMessageToParent } from '../../../lib/utils/cloudMessaging';
import { isInsForgeCloudProject, isIframe } from '../../../lib/utils/utils';
import type { DashboardAuthConfig } from '../../../types';

export default function CloudLoginPage() {
  const navigate = useNavigate();
  const host = useDashboardHost();
  const { isAuthenticated, error, loginWithAuthorizationCode } = useAuth();
  const hasRequestedAuthRef = useRef(false);
  const [requestError, setRequestError] = useState<Error | null>(null);

  useEffect(() => {
    if (hasRequestedAuthRef.current || isAuthenticated || error) {
      return;
    }

    if (host.mode === 'cloud-hosting') {
      if (host.auth.strategy !== 'authorization-code') {
        return;
      }

      const authorizationHostAuth = host.auth as Extract<
        DashboardAuthConfig,
        { strategy: 'authorization-code' }
      >;
      hasRequestedAuthRef.current = true;

      const authenticate = async () => {
        try {
          const code = await authorizationHostAuth.getAuthorizationCode();
          const success = await loginWithAuthorizationCode(code);
          if (!success) {
            throw new Error('Authorization code validation failed');
          }
        } catch (authError) {
          setRequestError(
            authError instanceof Error ? authError : new Error('Failed to authenticate')
          );
        }
      };

      void authenticate();
      return;
    }

    if (!isInsForgeCloudProject() || !isIframe()) {
      return;
    }

    hasRequestedAuthRef.current = true;
    postMessageToParent({ type: 'REQUEST_AUTHORIZATION_CODE' });
  }, [error, host, isAuthenticated, loginWithAuthorizationCode]);

  useEffect(() => {
    if (isAuthenticated) {
      void navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // Show error state if authentication failed
  const displayError = requestError ?? error;

  if (displayError) {
    return (
      <div className="min-h-screen bg-neutral-800 flex items-center justify-center px-4">
        <div className="text-center text-white">
          <LockIcon className="h-12 w-12 mx-auto mb-4 text-red-400" />
          <h2 className="text-xl font-semibold mb-2">Authentication Failed</h2>
          <p className="text-gray-400 text-sm max-w-md">{displayError.message}</p>
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
