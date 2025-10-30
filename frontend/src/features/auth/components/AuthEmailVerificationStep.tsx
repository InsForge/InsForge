import { useState, useEffect } from 'react';
import { authService } from '../services/auth.service';
import { AuthVerificationCodeInput } from './AuthVerificationCodeInput';

type VerificationMethod = 'code' | 'link';

interface AuthEmailVerificationStepProps {
  email: string;
  title?: string;
  description?: string;
  method?: VerificationMethod;
  onVerifyCode?: (code: string) => Promise<void>;
}

/**
 * Email verification step component
 *
 * Handles the email verification flow:
 * - Automatically sends verification email on mount
 * - Shows countdown timer for resend functionality
 * - Manages rate limiting for resend attempts
 * - Supports both code and link verification methods
 *
 * @param method - 'code' for OTP input, 'link' for magic link (default: 'code')
 */
export function AuthEmailVerificationStep({
  email,
  title = 'Verify Your Email',
  description,
  method = 'code',
  onVerifyCode,
}: AuthEmailVerificationStepProps) {
  const [resendDisabled, setResendDisabled] = useState(true);
  const [resendCountdown, setResendCountdown] = useState(60);
  const [isSending, setIsSending] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState('');

  // Default descriptions based on method
  const defaultDescription =
    method === 'code'
      ? "We've sent a 6-digit verification code to {email}. Please enter it below to verify your account. The code will expire in 10 minutes."
      : "We've sent a verification link to {email}. Please check your email and click the link to verify your account. The link will expire in 10 minutes.";

  // Auto-send verification email on mount
  useEffect(() => {
    const sendInitialEmail = async () => {
      try {
        if (method === 'code') {
          await authService.sendVerificationCode({ email });
        } else {
          await authService.sendVerificationLink({ email });
        }
      } catch {
        // Silently fail to prevent email enumeration
        // User can still use the resend button if needed
      }
    };

    void sendInitialEmail();
  }, [email, method]);

  // Countdown timer effect
  useEffect(() => {
    if (resendCountdown > 0) {
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
  }, [resendCountdown]);

  const handleResend = async () => {
    setResendDisabled(true);
    setResendCountdown(60);
    setIsSending(true);
    setVerificationError('');

    try {
      if (method === 'code') {
        await authService.sendVerificationCode({ email });
      } else {
        await authService.sendVerificationLink({ email });
      }
    } catch {
      // If resend fails, re-enable the button immediately
      setResendDisabled(false);
      setResendCountdown(0);
    } finally {
      setIsSending(false);
    }
  };

  const handleVerifyCode = async (code: string) => {
    if (!onVerifyCode) {
      return;
    }

    setIsVerifying(true);
    setVerificationError('');

    try {
      await onVerifyCode(code);
    } catch (error) {
      setVerificationError(
        error instanceof Error ? error.message : 'Invalid verification code. Please try again.'
      );
      setVerificationCode('');
    } finally {
      setIsVerifying(false);
    }
  };

  const displayDescription = description || defaultDescription;

  return (
    <div className="w-full flex flex-col gap-6 items-center">
      {/* Message Box */}
      <div className="w-full bg-neutral-100 dark:bg-neutral-800 rounded-lg px-4 pt-4 pb-6 flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-black dark:text-white">{title}</h2>
        <p className="text-neutral-600 dark:text-neutral-400 text-sm leading-relaxed">
          {displayDescription.split('{email}').map((part, index, array) => (
            <span key={index}>
              {part}
              {index < array.length - 1 && (
                <span className="font-medium text-black dark:text-white">{email}</span>
              )}
            </span>
          ))}
        </p>

        {/* Code Input (only for 'code' method) */}
        {method === 'code' && (
          <div className="flex flex-col gap-3 mt-2">
            <AuthVerificationCodeInput
              value={verificationCode}
              onChange={setVerificationCode}
              disabled={isVerifying}
              onComplete={(code) => {
                void handleVerifyCode(code);
              }}
            />
            {verificationError && (
              <p className="text-sm text-red-600 dark:text-red-400 text-center">
                {verificationError}
              </p>
            )}
            {isVerifying && (
              <p className="text-sm text-neutral-600 dark:text-neutral-400 text-center">
                Verifying...
              </p>
            )}
          </div>
        )}
      </div>

      {/* Resend Button */}
      <div className="w-full text-sm text-center text-neutral-600 dark:text-neutral-400">
        Didn&apos;t receive the email?{' '}
        <button
          onClick={() => {
            void handleResend();
          }}
          disabled={resendDisabled || isSending}
          className="text-black dark:text-white font-medium transition-colors disabled:cursor-not-allowed cursor-pointer hover:underline disabled:no-underline disabled:opacity-50"
        >
          {isSending
            ? 'Sending...'
            : resendDisabled
              ? `Retry in (${resendCountdown}s)`
              : 'Click to resend'}
        </button>
      </div>
    </div>
  );
}
