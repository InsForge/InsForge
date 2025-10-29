import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import InsForgeLogo from '@/assets/logos/insforge_light.svg?react';
import broadcastService, { BroadcastEventType } from '@/lib/services/broadcastService';

/**
 * Email verification page
 *
 * This page is accessed when users click the verification link in their email.
 * It verifies the email using the token from the URL and broadcasts the success
 * to other tabs via BroadcastChannel API.
 *
 * Flow:
 * 1. User clicks verification link in email → arrives at this page with token
 * 2. Page calls backend to verify email with token
 * 3. Backend returns access token
 * 4. Page broadcasts success event to signin/signup tabs
 * 5. Those tabs receive the token and redirect to user's app
 */
export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [verifying, setVerifying] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const verifyEmail = async () => {
      const email = searchParams.get('email');
      const code = searchParams.get('code');

      // Validate required parameters
      if (!email || !code) {
        setError('Invalid verification link. Missing required parameters.');
        setVerifying(false);
        return;
      }

      try {
        // Call backend to verify email
        const response = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email,
            verificationCode: code,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            (errorData as { message?: string }).message ||
              'Email verification failed. Please try again.'
          );
        }

        const data = await response.json();
        const accessToken = (data as { accessToken?: string }).accessToken;

        if (!accessToken) {
          throw new Error('Verification succeeded but no access token received');
        }

        // Broadcast success to other tabs (signin/signup pages)
        broadcastService.broadcast(BroadcastEventType.EMAIL_VERIFIED_SUCCESS, {
          accessToken,
          email,
        });

        // Show success message briefly
        setVerifying(false);

        // Redirect to dashboard after short delay
        setTimeout(() => {
          void navigate('/dashboard');
        }, 1500);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Email verification failed');
        setVerifying(false);
      }
    };

    void verifyEmail();
  }, [searchParams, navigate]);

  if (verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-gray-50 to-gray-100 dark:from-neutral-900 dark:to-neutral-800">
        <div className="max-w-[400px] w-full flex flex-col items-stretch justify-center bg-white dark:bg-neutral-900 rounded-xl shadow-[0_4px_12px_0_rgba(0,0,0,0.05)]">
          <div className="w-full p-6 flex flex-col items-center justify-center gap-6">
            <h2 className="text-2xl font-semibold text-black dark:text-white">
              Verifying your email...
            </h2>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-black dark:border-white" />
          </div>

          {/* Insforge Branding */}
          <div className="py-4 px-2 flex flex-row items-center justify-center gap-1 bg-neutral-50 dark:bg-neutral-50 font-manrope">
            <p className="text-xs text-black">Secured by</p>
            <a href="https://insforge.dev" target="_blank" rel="noopener noreferrer">
              <InsForgeLogo className="w-21 h-5" />
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-gray-50 to-gray-100 dark:from-neutral-900 dark:to-neutral-800 px-4">
        <div className="max-w-[400px] w-full flex flex-col items-stretch justify-center bg-white dark:bg-neutral-900 rounded-xl shadow-[0_4px_12px_0_rgba(0,0,0,0.05)]">
          <div className="w-full p-6 flex flex-col items-stretch justify-center gap-6">
            <div className="flex flex-col items-start justify-center gap-2">
              <h1 className="text-2xl font-semibold text-black dark:text-white">
                Verification Failed
              </h1>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
                {error}
              </p>
            </div>

            <Link
              to="/"
              className="flex items-center justify-center gap-2 w-full h-10 px-4 py-2 rounded bg-black hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-200 dark:text-black text-white font-medium transition-colors"
            >
              <Home className="w-5 h-5" />
              Go to Home
            </Link>
          </div>

          {/* Insforge Branding */}
          <div className="py-4 px-2 flex flex-row items-center justify-center gap-1 bg-neutral-50 dark:bg-neutral-50 font-manrope">
            <p className="text-xs text-black">Secured by</p>
            <a href="https://insforge.dev" target="_blank" rel="noopener noreferrer">
              <InsForgeLogo className="w-21 h-5" />
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Success state
  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-gray-50 to-gray-100 dark:from-neutral-900 dark:to-neutral-800">
      <div className="max-w-[400px] w-full flex flex-col items-stretch justify-center bg-white dark:bg-neutral-900 rounded-xl shadow-[0_4px_12px_0_rgba(0,0,0,0.05)]">
        <div className="w-full p-6 flex flex-col items-center justify-center gap-6">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-green-600 dark:text-green-400"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-black dark:text-white text-center">
              Email Verified!
            </h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 text-center">
              Redirecting to dashboard...
            </p>
          </div>
        </div>

        {/* Insforge Branding */}
        <div className="py-4 px-2 flex flex-row items-center justify-center gap-1 bg-neutral-50 dark:bg-neutral-50 font-manrope">
          <p className="text-xs text-black">Secured by</p>
          <a href="https://insforge.dev" target="_blank" rel="noopener noreferrer">
            <InsForgeLogo className="w-21 h-5" />
          </a>
        </div>
      </div>
    </div>
  );
}
