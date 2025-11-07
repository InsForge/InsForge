import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LockIcon } from 'lucide-react';
import { useAuth } from '@/lib/contexts/AuthContext';
import { postMessageToParent } from '@/lib/utils/cloudMessaging';

export default function CloudLoginPage() {
  const navigate = useNavigate();
  const { loginWithAuthorizationCode, isAuthenticated } = useAuth();
  const [authError, setAuthError] = useState<string | null>(null);

  // Handle authorization code from postMessage
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Validate origin - allow insforge.dev and *.insforge.dev domains
      const isInsforgeOrigin =
        event.origin.endsWith('.insforge.dev') || event.origin === 'https://insforge.dev';

      if (!isInsforgeOrigin) {
        console.warn('Received message from unauthorized origin:', event.origin);
        return;
      }

      // Check if this is an authorization code message
      if (event.data?.type === 'AUTHORIZATION_CODE' && event.data?.code) {
        const authorizationCode = event.data.code;

        setAuthError(null);
        // Exchange the authorization code for an access token
        loginWithAuthorizationCode(authorizationCode)
          .then((success) => {
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
          })
          .catch((error) => {
            console.error('Authorization code exchange failed:', error);
            setAuthError('The authorization code may have expired or already been used.');
            postMessageToParent(
              {
                type: 'AUTH_ERROR',
                message: 'Authorization code validation failed',
              },
              event.origin
            );
          });
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [loginWithAuthorizationCode]);

  useEffect(() => {
    if (isAuthenticated) {
      void navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

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
