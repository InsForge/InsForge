import { useSearchParams } from 'react-router-dom';
import { VerifyEmail } from '@insforge/react';
import broadcastService, { BroadcastEventType } from '../lib/broadcastService';

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-gray-50 to-gray-100 dark:from-neutral-900 dark:to-neutral-800">
      <VerifyEmail
        token={token || ''}
        onSuccess={(data) => {
          broadcastService.broadcast(BroadcastEventType.EMAIL_VERIFIED_SUCCESS, data);
        }}
        onError={(error) => {
          console.error('Email verification failed:', error);
        }}
      />
    </div>
  );
}
