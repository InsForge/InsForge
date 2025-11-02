import { useState, FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ForgotPasswordForm } from '@insforge/react';
import { useInsforge } from '@insforge/react';

export function ForgotPasswordPage() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const { sendPasswordResetCode } = useInsforge();

  const redirectUrl = searchParams.get('redirect');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address');
      setLoading(false);
      return;
    }

    try {
      const result = await sendPasswordResetCode(email);

      if (result?.success) {
        setSuccess(true);
      } else {
        setError(result?.message || 'Failed to send reset code');
        setLoading(false);
        return;
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send reset code');
    } finally {
      setLoading(false);
    }
  }

  const backToSignInUrl = `/auth/sign-in${redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : ''}`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-gray-50 to-gray-100 dark:from-neutral-900 dark:to-neutral-800">
      <ForgotPasswordForm
        email={email}
        onEmailChange={setEmail}
        onSubmit={handleSubmit}
        error={error}
        loading={loading}
        success={success}
        backToSignInUrl={backToSignInUrl}
      />
    </div>
  );
}
