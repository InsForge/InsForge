import { useSearchParams } from 'react-router-dom';
import { VerifyEmail } from '@insforge/react';
import broadcastService, { BroadcastEventType } from '../lib/broadcastService';

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const redirectTo = searchParams.get('redirectTo');

  return (
    <VerifyEmail
      token={token || ''}
      onSuccess={(data) => {
        broadcastService.broadcast(BroadcastEventType.EMAIL_VERIFIED_SUCCESS, data);
        // Redirect to custom URL if provided
        if (redirectTo) {
          const { accessToken, user, csrfToken } = data;
          if (accessToken && user) {
            const finalUrl = new URL(redirectTo, window.location.origin);
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
