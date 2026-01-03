import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LockIcon } from 'lucide-react';
import { useAuth } from '@/lib/contexts/AuthContext';
import { postMessageToParent } from '@/lib/utils/cloudMessaging';
import { useMcpUsage } from '@/features/logs/hooks/useMcpUsage';
import { usePartnerOrigin } from '../hooks/usePartnerOrigin';
import { useModal } from '@/lib/contexts/ModalContext';

export default function CloudLoginPage() {
  const navigate = useNavigate();
  const { loginWithAuthorizationCode, isAuthenticated } = useAuth();
  const { hasCompletedOnboarding, isLoading: isMcpUsageLoading } = useMcpUsage();
  const { isPartnerOrigin } = usePartnerOrigin();
  const [authError, setAuthError] = useState<string | null>(null);
  const { setOnboardingModalOpen } = useModal();
  // Handle authorization code from postMessage
  const onAuthorizationCodeReceived = useCallback(
    async (event: MessageEvent) => {
      try {
        // Validate origin - allow insforge.dev, *.insforge.dev, and partner domains
        const isInsforgeOrigin =
          event.origin.endsWith('.insforge.dev') || event.origin === 'https://insforge.dev';

        if (!isInsforgeOrigin) {
          const isPartner = await isPartnerOrigin(event.origin);
          if (!isPartner) {
            console.warn('Received message from unauthorized origin:', event.origin);
            return;
          }
        }

        const authorizationCode = event.data.code;

        setAuthError(null);
        // Exchange the authorization code for an access token
        const success = await loginWithAuthorizationCode(authorizationCode);
        if (success) {
          // Notify parent of success
          postMessageToParent(
            {
              type: 'AUTH_SUCCESS',
            },
            event.origin
          );
        } else {
          setAuthError('The authorization code may have expired or already been used.');
          postMessageToParent(
            {
              type: 'AUTH_ERROR',
              message: 'Authorization code validation failed',
            },
            event.origin
          );
        }
      } catch (error) {
        console.error('Authorization code exchange failed:', error);
        setAuthError('The authorization code may have expired or already been used.');
        postMessageToParent(
          {
            type: 'AUTH_ERROR',
            message: 'Authorization code validation failed',
          },
          event.origin
        );
      }
    },
    [loginWithAuthorizationCode, isPartnerOrigin]
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'AUTHORIZATION_CODE' && event.data?.code) {
        void onAuthorizationCodeReceived(event);
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [onAuthorizationCodeReceived]);

  useEffect(() => {
    if (isAuthenticated && !isMcpUsageLoading) {
      if (!hasCompletedOnboarding) {
        setOnboardingModalOpen(true);
      }
      void navigate('/dashboard', { replace: true });
    }
  }, [hasCompletedOnboarding, isAuthenticated, isMcpUsageLoading, navigate]);

  // Show error state if authentication failed
  if (authError) {
    return (
      <div className="min-h-screen bg-neutral-800 flex items-center justify-center px-4">
        <div className="text-center text-white">
          <LockIcon className="h-12 w-12 mx-auto mb-4 text-red-400" />
          <h2 className="text-xl font-semibold mb-2">Authentication Failed</h2>
          <p className="text-gray-400 text-sm max-w-md">{authError}</p>
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
