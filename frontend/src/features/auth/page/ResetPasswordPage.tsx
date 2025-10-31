import { useSearchParams } from 'react-router-dom';
import { ResetPasswordForm } from '../components/ResetPasswordForm';
import InsForgeLogo from '@/assets/logos/insforge_light.svg?react';

/**
 * Reset password page for email link flow
 * Handles password reset via URL token parameter (e.g., /auth/reset-password?token=XXXX)
 */
export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-gray-50 to-gray-100 dark:from-neutral-900 dark:to-neutral-800">
        <div className="max-w-[400px] w-full flex flex-col items-stretch justify-center bg-white dark:bg-neutral-900 rounded-xl shadow-[0_4px_12px_0_rgba(0,0,0,0.05)]">
          <div className="w-full p-6 flex flex-col items-stretch justify-center gap-6">
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-gray-50 to-gray-100 dark:from-neutral-900 dark:to-neutral-800">
      <div className="max-w-[400px] w-full flex flex-col items-stretch justify-center bg-white dark:bg-neutral-900 rounded-xl shadow-[0_4px_12px_0_rgba(0,0,0,0.05)]">
        <div className="w-full p-6 flex flex-col items-stretch justify-center gap-6">
          <ResetPasswordForm otp={token} />
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
