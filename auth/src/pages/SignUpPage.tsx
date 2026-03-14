import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SignUp } from '@insforge/react';
import broadcastService, { BroadcastEventType, BroadcastEvent } from '../lib/broadcastService';
import { ErrorCard } from '../components/ErrorCard';
import { useValidatedRedirectTarget } from '../lib/redirectValidation';

export function SignUpPage() {
  const [searchParams] = useSearchParams();
  const redirectUrl = searchParams.get('redirect');
  const { validatedRedirect, validationError, isLoading } = useValidatedRedirectTarget(
    redirectUrl,
    'Redirect URL'
  );

  // Listen for email verification success from other tabs
  useEffect(() => {
    if (!validatedRedirect) {
      return;
    }

    const unsubscribeVerified = broadcastService.subscribe(
      BroadcastEventType.EMAIL_VERIFIED_SUCCESS,
      (event: BroadcastEvent) => {
        const { accessToken, user, csrfToken } = event.data || {};
        if (accessToken && user) {
          // Email verified in another tab, redirect with token
          try {
            const finalUrl = new URL(validatedRedirect);
            const params = new URLSearchParams();
            params.set('access_token', accessToken);
            params.set('user_id', user.id);
            params.set('email', user.email);
            params.set('name', String(user.profile?.name));
            if (csrfToken) {
              params.set('csrf_token', csrfToken);
            }
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
  }, [validatedRedirect]);

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

  if (isLoading) {
    return (
      <ErrorCard title="Validating Redirect URL">
        <p>Please wait while InsForge validates your redirect destination.</p>
      </ErrorCard>
    );
  }

  if (validationError) {
    return (
      <ErrorCard title="Invalid Redirect URL">
        <p>{validationError}</p>
      </ErrorCard>
    );
  }

  return <SignUp onError={handleError} />;
}
