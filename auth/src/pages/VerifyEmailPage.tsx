import { useSearchParams } from 'react-router-dom';
import { VerifyEmail } from '@insforge/react';
import broadcastService, { BroadcastEventType } from '../lib/broadcastService';

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  return (
    <VerifyEmail
      token={token || ''}
      onSuccess={(data) => {
        broadcastService.broadcast(BroadcastEventType.EMAIL_VERIFIED_SUCCESS, data);
      }}
      onError={(error) => {
        console.error('Email verification failed:', error);
      }}
    />
  );
}
