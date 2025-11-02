import { useSearchParams } from 'react-router-dom';
import { ResetPassword } from '@insforge/react';
import { AuthRouterPath } from '@/App';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();

  const token = searchParams.get('token');
  const redirectUrl = searchParams.get('redirect');
  const backToSignInUrl = `${AuthRouterPath.SIGN_IN}${redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : ''}`;

  // Handle missing token
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-gray-50 to-gray-100 dark:from-neutral-900 dark:to-neutral-800">
        <div className="max-w-[400px] w-full flex flex-col items-stretch justify-center bg-white dark:bg-neutral-900 rounded-xl shadow-[0_4px_12px_0_rgba(0,0,0,0.05)] p-6">
          <div className="flex flex-col items-start justify-center gap-2">
            <h1 className="text-2xl font-semibold text-black dark:text-white">
              Invalid Reset Link
            </h1>
            <p className="text-sm text-[#828282]">
              The password reset link is invalid or has expired. Please request a new password
              reset.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-gray-50 to-gray-100 dark:from-neutral-900 dark:to-neutral-800">
      <ResetPassword
        token={token}
        backToSignInUrl={backToSignInUrl}
        onError={(error) => {
          console.error('Failed to reset password:', error);
        }}
      />
    </div>
  );
}
