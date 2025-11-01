import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { VerifyEmailStatus, useInsforge } from '@insforge/react';
import broadcastService, { BroadcastEventType } from '../lib/broadcastService';

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [error, setError] = useState('');

  const { verifyEmail } = useInsforge();

  useEffect(() => {
    const verifyEmailFn = async () => {
      const token = searchParams.get('token');

      if (!token) {
        setError('Invalid verification link. Missing required parameters.');
        setStatus('error');
        return;
      }

      try {
        const result = await verifyEmail(token);

        const accessToken = result?.accessToken;

        if (!accessToken) {
          setError('Verification succeeded but no access token received');
          setStatus('error');
          return;
        }

        // Broadcast success event
        broadcastService.broadcast(BroadcastEventType.EMAIL_VERIFIED_SUCCESS, {
          accessToken,
          user: result?.user,
        });

        setStatus('success');
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Email verification failed');
        setStatus('error');
      }
    };

    void verifyEmailFn();
  }, [searchParams, verifyEmail]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-gray-50 to-gray-100 dark:from-neutral-900 dark:to-neutral-800">
      <VerifyEmailStatus status={status} error={error} />
    </div>
  );
}
