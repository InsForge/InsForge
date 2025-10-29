import { useState, useEffect } from 'react';

interface AuthEmailMessageBoxProps {
  email: string;
  onResend: () => Promise<void>;
  title: string;
  description: string;
  initiallyDisabled?: boolean;
}

/**
 * Email verification message box with resend functionality and countdown timer
 *
 * Displays a message to the user about email verification and provides
 * a button to resend the verification email with rate limiting.
 */
export function AuthEmailMessageBox({
  email,
  onResend,
  title,
  description,
  initiallyDisabled = true,
}: AuthEmailMessageBoxProps) {
  const [resendDisabled, setResendDisabled] = useState(initiallyDisabled);
  const [resendCountdown, setResendCountdown] = useState(initiallyDisabled ? 60 : 0);

  // Countdown timer effect - starts immediately on mount
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

    try {
      await onResend();
    } catch {
      // If resend fails, re-enable the button immediately
      setResendDisabled(false);
      setResendCountdown(0);
    }
  };

  return (
    <div className="w-full flex flex-col gap-6 items-center">
      {/* Message Box */}
      <div className="w-full bg-neutral-100 dark:bg-neutral-800 rounded-lg px-4 pt-4 pb-6 flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-black dark:text-white">{title}</h2>
        <p className="text-neutral-600 dark:text-neutral-400 text-sm leading-relaxed">
          {description.split('{email}').map((part, index, array) => (
            <span key={index}>
              {part}
              {index < array.length - 1 && (
                <span className="font-medium text-black dark:text-white">{email}</span>
              )}
            </span>
          ))}
        </p>
      </div>

      {/* Resend Button */}
      <div className="w-full text-sm text-center text-neutral-600 dark:text-neutral-400">
        Didn&apos;t receive the email?{' '}
        <button
          onClick={() => {
            void handleResend();
          }}
          disabled={resendDisabled}
          className="text-black dark:text-white font-medium transition-colors disabled:cursor-not-allowed cursor-pointer hover:underline disabled:no-underline disabled:opacity-50"
        >
          {resendDisabled ? `Retry in (${resendCountdown}s)` : 'Click to resend'}
        </button>
      </div>
    </div>
  );
}
