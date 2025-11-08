import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { VerifyEmail } from '@insforge/react';
import broadcastService, { BroadcastEventType } from '../lib/broadcastService';
import { ErrorCard } from '../components/ErrorCard';

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [checking, setChecking] = useState(true);
  const [hasListeners, setHasListeners] = useState(false);

  useEffect(() => {
    const checkListeners = async () => {
      try {
        setChecking(true);
        const found = await broadcastService.checkForListeners();
        setHasListeners(found);
      } catch (error) {
        console.error('Failed to check for listeners:', error);
        setHasListeners(false);
      } finally {
        setChecking(false);
      }
    };

    void checkListeners();
  }, []);

  if (checking) {
    return (
      <div className="max-w-100 w-full rounded-xl shadow-lg text-center bg-white p-6 flex items-center justify-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  if (!hasListeners) {
    return (
      <div className="max-w-100 w-full rounded-xl shadow-lg text-center bg-white p-6 flex items-center justify-center">
        <ErrorCard title="No Active Session Found">
          <div className="space-y-3">
            <p>
              This email verification link needs to be opened in the same browser where you
              initiated the sign-in or sign-up process.
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
              <p className="text-sm text-blue-800 font-medium mb-2">To verify your email:</p>
              <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
                <li>Go back to the browser tab where you started signing in/up</li>
                <li>Copy this verification link</li>
                <li>Open it in a new tab in that same browser</li>
              </ol>
            </div>
          </div>
        </ErrorCard>
      </div>
    );
  }

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
