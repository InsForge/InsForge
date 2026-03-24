import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SignIn } from '@insforge/react';
import broadcastService, { BroadcastEventType, BroadcastEvent } from '../lib/broadcastService';
import { ErrorCard } from '../components/ErrorCard';
import { buildSessionRedirectUrl } from '../lib/sessionRedirect';

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
        const { accessToken, user, csrfToken } = event.data || {};
        if (accessToken && user) {
          // Email verified in another tab, redirect with token
          try {
            window.location.assign(
              buildSessionRedirectUrl(redirectUrl, {
                accessToken,
                user,
                csrfToken,
              })
            );
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
