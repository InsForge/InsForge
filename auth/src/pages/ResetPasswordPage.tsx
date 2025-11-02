import { useState, FormEvent } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ResetPasswordForm, usePublicAuthConfig, useInsforge } from '@insforge/react';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { emailConfig } = usePublicAuthConfig();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { resetPassword } = useInsforge();
  const token = searchParams.get('token');
  const redirectUrl = searchParams.get('redirect');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      setLoading(false);
      return;
    }

    if (!token) {
      setError('Token is required');
      setLoading(false);
      return;
    }

    try {
      const result = await resetPassword(token, newPassword);

      if (result?.redirectTo) {
        navigate(result.redirectTo);
      } else {
        setError('Failed to reset password');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  }

  const backToSignInUrl = `/auth/signin${redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : ''}`;

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
      <ResetPasswordForm
        newPassword={newPassword}
        confirmPassword={confirmPassword}
        onNewPasswordChange={setNewPassword}
        onConfirmPasswordChange={setConfirmPassword}
        onSubmit={handleSubmit}
        error={error}
        loading={loading}
        emailAuthConfig={emailConfig || undefined}
        backToSignInUrl={backToSignInUrl}
      />
    </div>
  );
}
