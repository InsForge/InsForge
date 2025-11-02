import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SignUp } from '@insforge/react';
import broadcastService, { BroadcastEventType, BroadcastEvent } from '../lib/broadcastService';
import { AuthRouterPath } from '@/App';

export function SignUpPage() {
  const [searchParams] = useSearchParams();
  const redirectUrl = searchParams.get('redirect');

  // Listen for email verification success from other tabs
  useEffect(() => {
    if (!redirectUrl) return;

    const unsubscribe = broadcastService.subscribe(
      BroadcastEventType.EMAIL_VERIFIED_SUCCESS,
      (event: BroadcastEvent) => {
        const { accessToken, user } = event.data || {};
        if (accessToken && user) {
          // Email verified in another tab, redirect with token
          try {
            const finalUrl = new URL(redirectUrl, window.location.origin);
            const params = new URLSearchParams();
            params.set('access_token', accessToken);
            params.set('user_id', user.id);
            params.set('email', user.email);
            params.set('name', user.name);
            finalUrl.search = params.toString();
            window.location.href = finalUrl.toString();
          } catch {
            console.error('Failed to redirect to final URL');
          }
        }
      }
    );

    return () => unsubscribe();
  }, [redirectUrl]);

  const handleSuccessfulAuth = useCallback(
    (user: { id: string; email: string; name: string }, accessToken: string) => {
      if (redirectUrl) {
        try {
          const finalUrl = new URL(redirectUrl, window.location.origin);
          const params = new URLSearchParams();
          params.set('access_token', accessToken);
          params.set('user_id', user.id);
          params.set('email', user.email);
          params.set('name', user.name);
          finalUrl.search = params.toString();
          window.location.href = finalUrl.toString();
        } catch {
          console.error('Failed to redirect to final URL');
        }
      } else {
        console.error('No redirect URL provided');
      }
    },
    [redirectUrl]
  );

  const handleError = useCallback((error: Error) => {
    console.error('Sign up failed:', error);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-gray-50 to-gray-100 dark:from-neutral-900 dark:to-neutral-800">
      <SignUp
        afterSignUpUrl={redirectUrl || ''}
        onSuccess={handleSuccessfulAuth}
        onError={handleError}
        signInUrl={AuthRouterPath.SIGN_IN}
      />
    </div>
  );
}
