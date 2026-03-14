import { useSearchParams } from 'react-router-dom';
import { VerifyEmail } from '@insforge/react';
import broadcastService, { BroadcastEventType } from '../lib/broadcastService';
import { ErrorCard } from '../components/ErrorCard';
import { useValidatedRedirectTarget } from '../lib/redirectValidation';

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const redirectTo = searchParams.get('redirectTo');
  const { validatedRedirect, validationError, isLoading } = useValidatedRedirectTarget(
    redirectTo,
    'Email verification redirect URL'
  );

  if (redirectTo && isLoading) {
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

  return (
    <VerifyEmail
      token={token || ''}
      onSuccess={(data) => {
        broadcastService.broadcast(BroadcastEventType.EMAIL_VERIFIED_SUCCESS, data);
        // Redirect to custom URL if provided
        if (validatedRedirect) {
          const { accessToken, user, csrfToken } = data;
          if (accessToken && user) {
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
          }
        }
      }}
      onError={(error) => {
        console.error('Email verification failed:', error);
      }}
    />
  );
}
