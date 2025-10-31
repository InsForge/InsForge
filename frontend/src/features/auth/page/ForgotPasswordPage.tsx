import { useState, FormEvent, useEffect, useCallback } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import {
  AuthFormField,
  AuthSubmitButton,
  AuthVerificationCodeInput,
  ResetPasswordForm,
} from '../components';
import InsForgeLogo from '@/assets/logos/insforge_light.svg?react';
import { authService } from '../services/auth.service';

type ForgotPasswordStep = 'email' | 'code' | 'password';

export default function ForgotPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [step, setStep] = useState<ForgotPasswordStep>('email');
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendDisabled, setResendDisabled] = useState(true);
  const [resendCountdown, setResendCountdown] = useState(60);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);

  const redirectUrl = searchParams.get('redirect');

  const handleEmailSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Basic email validation
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address');
      setLoading(false);
      return;
    }

    try {
      await authService.sendResetPasswordCode({ email });
      setStep('code');
      setResendDisabled(true);
      setResendCountdown(60);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send reset code');
    } finally {
      setLoading(false);
    }
  };

  // Countdown timer effect for resend
  useEffect(() => {
    if (resendCountdown > 0 && step === 'code') {
      const timer = setInterval(() => {
        setResendCountdown((prev) => {
          if (prev <= 1) {
            setResendDisabled(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [resendCountdown, step]);

  const handleVerifyCode = async (code: string): Promise<void> => {
    setIsVerifyingCode(true);
    setError('');
    setVerificationCode(code);

    try {
      // Verify code and get reset token
      const result = await authService.verifyResetPasswordCode({ email, code });
      setResetToken(result.resetToken);
      setStep('password');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to verify code');
      setVerificationCode('');
    } finally {
      setIsVerifyingCode(false);
    }
  };

  const handleResendCode = useCallback(async () => {
    setResendDisabled(true);
    setResendCountdown(60);
    setIsSendingCode(true);
    setError('');

    try {
      await authService.sendResetPasswordCode({ email });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to resend code');
      setResendDisabled(false);
      setResendCountdown(0);
    } finally {
      setIsSendingCode(false);
    }
  }, [email]);

  const handlePasswordResetSuccess = () => {
    // Redirect to sign in page with redirect param preserved
    const signInUrl = `/auth/signin${redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : ''}`;
    void navigate(signInUrl);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-gray-50 to-gray-100 dark:from-neutral-900 dark:to-neutral-800">
      <div className="max-w-[400px] w-full flex flex-col items-stretch justify-center bg-white dark:bg-neutral-900 rounded-xl shadow-[0_4px_12px_0_rgba(0,0,0,0.05)]">
        <div className="w-full p-6 flex flex-col items-stretch justify-center gap-6">
          {step === 'email' ? (
            <>
              <div className="flex flex-col items-start justify-center gap-2">
                <h1 className="text-2xl font-semibold text-black dark:text-white">
                  Forgot Password?
                </h1>
                <p className="text-sm text-[#828282]">
                  Enter your email address and we&apos;ll send you a code to reset your password.
                </p>
              </div>

              {error && (
                <div className="mb-4 pl-3 py-2 pr-2 bg-red-50 border-2 border-red-600 rounded">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0" />
                    <p className="text-sm text-red-600 flex-1">{error}</p>
                  </div>
                </div>
              )}

              <form
                onSubmit={(e) => {
                  void handleEmailSubmit(e);
                }}
                noValidate
                className="flex flex-col items-stretch justify-center gap-6"
              >
                <AuthFormField
                  id="email"
                  type="email"
                  label="Email"
                  placeholder="example@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />

                <AuthSubmitButton isLoading={loading} disabled={loading}>
                  {loading ? 'Sending...' : 'Send Reset Code'}
                </AuthSubmitButton>
              </form>

              <p className="text-center text-sm text-gray-600 dark:text-gray-400">
                Remember your password?{' '}
                <Link
                  to={`/auth/signin${redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : ''}`}
                  className="text-black dark:text-white font-medium"
                >
                  Back to Sign In
                </Link>
              </p>
            </>
          ) : step === 'code' ? (
            <>
              <div className="flex flex-col items-start justify-center gap-2">
                <h1 className="text-2xl font-semibold text-black dark:text-white">
                  Enter Reset Code
                </h1>
                <p className="text-sm text-[#828282]">
                  We&apos;ve sent a 6-digit verification code to{' '}
                  <span className="font-medium text-black dark:text-white">{email}</span>. Please
                  enter it below to reset your password. The code will expire in 10 minutes.
                </p>
              </div>

              {error && (
                <div className="mb-4 pl-3 py-2 pr-2 bg-red-50 border-2 border-red-600 rounded">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0" />
                    <p className="text-sm text-red-600 flex-1">{error}</p>
                  </div>
                </div>
              )}

              <div className="w-full flex flex-col gap-6 items-center">
                <div className="w-full bg-neutral-100 dark:bg-neutral-800 rounded-lg px-4 pt-4 pb-6 flex flex-col gap-4">
                  <div className="flex flex-col gap-3 mt-2">
                    <AuthVerificationCodeInput
                      value={verificationCode}
                      onChange={setVerificationCode}
                      disabled={isVerifyingCode}
                      onComplete={(code) => {
                        void handleVerifyCode(code);
                      }}
                    />
                    {isVerifyingCode && (
                      <p className="text-sm text-neutral-600 dark:text-neutral-400 text-center">
                        Verifying...
                      </p>
                    )}
                  </div>
                </div>

                <div className="w-full text-sm text-center text-neutral-600 dark:text-neutral-400">
                  Didn&apos;t receive the email?{' '}
                  <button
                    onClick={() => {
                      void handleResendCode();
                    }}
                    disabled={resendDisabled || isSendingCode}
                    className="text-black dark:text-white font-medium transition-colors disabled:cursor-not-allowed cursor-pointer hover:underline disabled:no-underline disabled:opacity-50"
                  >
                    {isSendingCode
                      ? 'Sending...'
                      : resendDisabled
                        ? `Retry in (${resendCountdown}s)`
                        : 'Click to resend'}
                  </button>
                </div>
              </div>

              <p className="text-center text-sm text-gray-600 dark:text-gray-400">
                <Link
                  to={`/auth/signin${redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : ''}`}
                  className="text-black dark:text-white font-medium"
                >
                  Back to Sign In
                </Link>
              </p>
            </>
          ) : (
            <ResetPasswordForm otp={resetToken} onSuccess={handlePasswordResetSuccess} />
          )}
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
