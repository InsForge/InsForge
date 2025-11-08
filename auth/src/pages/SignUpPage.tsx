import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SignUp } from '@insforge/react';
import broadcastService, { BroadcastEventType, BroadcastEvent } from '../lib/broadcastService';
import { ErrorCard } from '../components/ErrorCard';

export function SignUpPage() {
  const [searchParams] = useSearchParams();
  const redirectUrl = searchParams.get('redirect');

  // Listen for email verification success from other tabs
  useEffect(() => {
    if (!redirectUrl) {
      return;
    }

    // Listen for PING and respond with PONG
    const unsubscribePing = broadcastService.subscribe(BroadcastEventType.PING, () => {
      broadcastService.broadcast(BroadcastEventType.PONG);
    });

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
      unsubscribePing();
      unsubscribeVerified();
    };
  }, [redirectUrl]);

  const handleError = useCallback((error: Error) => {
    console.error('Sign up failed:', error);
  }, []);

  if (!redirectUrl) {
    return (
      <ErrorCard title="Missing Redirect URL">
        <p>No redirect URL provided. Please check the URL and try again.</p>
      </ErrorCard>
    );
  }

  return <SignUp onError={handleError} />;
}
