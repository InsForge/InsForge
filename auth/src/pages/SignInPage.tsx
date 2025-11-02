import { useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { SignIn } from '@insforge/react';
import broadcastService, { BroadcastEventType } from '../lib/broadcastService';

export function SignInPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const redirectUrl = searchParams.get('redirect');

  const handleSuccessfulAuth = useCallback(
    (user: { id: string; email: string; name: string }, accessToken: string) => {
      // Broadcast authentication event to other tabs
      broadcastService.broadcast(BroadcastEventType.EMAIL_VERIFIED_SUCCESS, {
        accessToken,
        user,
      });

      // Handle redirect
      if (redirectUrl) {
        try {
          const finalUrl = new URL(redirectUrl, window.location.origin);
          const params = new URLSearchParams();
          if (user?.id) params.set('user_id', user.id);
          if (user?.email) params.set('email', user.email);
          if (user?.name) params.set('name', user.name);
          finalUrl.search = params.toString();
          window.location.assign(finalUrl.toString());
        } catch {
          window.location.assign('/dashboard');
        }
      } else {
        window.location.assign('/dashboard');
      }
    },
    [redirectUrl]
  );

  const handleError = useCallback((error: Error) => {
    console.error('Sign in failed:', error);
  }, []);

  const handleRedirect = useCallback(
    (url: string) => {
      navigate(url);
    },
    [navigate]
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-gray-50 to-gray-100 dark:from-neutral-900 dark:to-neutral-800">
      <SignIn
        afterSignInUrl="/dashboard"
        onSuccess={handleSuccessfulAuth}
        onError={handleError}
        onRedirect={handleRedirect}
        signUpUrl="/auth/sign-up"
        forgotPasswordUrl="/auth/forgot-password"
      />
    </div>
  );
}
