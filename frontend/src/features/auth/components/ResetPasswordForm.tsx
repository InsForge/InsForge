import { useState, FormEvent, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { AuthPasswordField, AuthSubmitButton } from './index';
import { authService } from '../services/auth.service';
import { emailConfigService } from '../services/email-config.service';
import { PublicEmailAuthConfig } from '@insforge/shared-schemas';
import { validatePasswordAgainstConfig } from '@/lib/utils/password-validation';

interface ResetPasswordFormProps {
  email?: string;
  otp?: string;
  onSuccess?: () => void;
}

/**
 * Reusable reset password form component
 * Supports both code-based (email + otp) and link-based (otp only) password reset flows
 */
export function ResetPasswordForm({ email, otp, onSuccess }: ResetPasswordFormProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailConfig, setEmailConfig] = useState<PublicEmailAuthConfig | null>(null);

  const redirectUrl = searchParams.get('redirect');

  // Fetch email config on mount for password validation
  useEffect(() => {
    void emailConfigService
      .getPublicAuthConfig()
      .then((data) => {
        if (data?.email) {
          setEmailConfig(data.email);
        }
      })
      .catch((err: unknown) => console.error('Failed to fetch public auth config:', err));
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Validate passwords match
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    // Validate password strength if config is available
    if (emailConfig) {
      const isValid = validatePasswordAgainstConfig(newPassword, emailConfig);
      if (!isValid) {
        setError('Password does not meet the requirements');
        setLoading(false);
        return;
      }
    }

    try {
      // Validate otp is provided
      if (!otp) {
        setError('Verification code or token is required');
        setLoading(false);
        return;
      }

      // Build reset password request
      // If email is provided, use code-based reset (email + otp + newPassword)
      // Otherwise use link token reset (otp + newPassword, no email)
      const resetRequest = email ? { email, newPassword, otp } : { newPassword, otp };

      await authService.resetPassword(resetRequest);

      // Call success callback if provided, otherwise redirect to sign in
      if (onSuccess) {
        onSuccess();
      } else {
        const signInUrl = `/auth/signin${redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : ''}`;
        void navigate(signInUrl);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="flex flex-col items-start justify-center gap-2">
        <h1 className="text-2xl font-semibold text-black dark:text-white">Reset Password</h1>
        <p className="text-sm text-[#828282]">Enter your new password below.</p>
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
          void handleSubmit(e);
        }}
        noValidate
        className="flex flex-col items-stretch justify-center gap-6"
      >
        <AuthPasswordField
          id="newPassword"
          label="New Password"
          placeholder="••••••••"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          autoComplete="new-password"
          showStrengthIndicator={!!emailConfig}
          passwordConfig={emailConfig || undefined}
        />

        <AuthPasswordField
          id="confirmPassword"
          label="Confirm Password"
          placeholder="••••••••"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          autoComplete="new-password"
        />

        <AuthSubmitButton isLoading={loading} disabled={loading}>
          {loading ? 'Resetting...' : 'Reset Password'}
        </AuthSubmitButton>
      </form>

      <p className="text-center text-sm text-gray-600 dark:text-gray-400">
        <Link
          to={`/auth/signin${redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : ''}`}
          className="text-black dark:text-white font-medium"
        >
          Back to Sign In
        </Link>
      </p>
    </>
  );
}
