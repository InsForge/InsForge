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
          window.location.href = redirectTo;
        }
      }}
      onError={(error) => {
        console.error('Email verification failed:', error);
      }}
    />
  );
}
