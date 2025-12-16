import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SignIn } from '@insforge/react';
import broadcastService, { BroadcastEventType, BroadcastEvent } from '../lib/broadcastService';
import { ErrorCard } from '../components/ErrorCard';

export function SignInPage() {
  const [searchParams] = useSearchParams();
  const redirectUrl = searchParams.get('redirect');

  // Listen for email verification success from other tabs
  useEffect(() => {
    if (!redirectUrl) {
      return;
    }

    const unsubscribeVerified = broadcastService.subscribe(
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

    return () => {
      unsubscribeVerified();
    };
  }, [redirectUrl]);

  const handleError = useCallback((error: Error) => {
    console.error('Sign in failed:', error);
  }, []);

  if (!redirectUrl) {
    return (
      <ErrorCard title="Missing Redirect URL">
        <p>No redirect URL provided. Please check the URL and try again.</p>
      </ErrorCard>
    );
  }

  return <SignIn onError={handleError} />;
}
