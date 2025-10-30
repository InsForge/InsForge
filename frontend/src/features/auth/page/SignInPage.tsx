import { useState, FormEvent, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { OAuthProvidersSchema, UserSchema } from '@insforge/shared-schemas';
import { AlertTriangle } from 'lucide-react';
import {
  AuthFormField,
  AuthPasswordField,
  AuthSubmitButton,
  AuthOAuthProviders,
  AuthEmailVerificationStep,
} from '../components';
import InsForgeLogo from '@/assets/logos/insforge_light.svg?react';
import { signInFormSchema } from '@/lib/utils/validation-schemas';
import broadcastService, { BroadcastEventType } from '@/lib/services/broadcastService';
import { oauthConfigService } from '../services/oauth-config.service';
import { authService } from '../services/auth.service';

type SignInStep = 'form' | 'awaiting-verification';

export default function SignInPage() {
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<SignInStep>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvidersSchema | null>(null);
  const [availableProviders, setAvailableProviders] = useState<OAuthProvidersSchema[]>([]);

  const redirectUrl = searchParams.get('redirect');

  const handleSuccessfulAuth = useCallback(
    (data: { accessToken: string; user?: UserSchema }) => {
      // Redirect back to user's app with token and user info (consistent with OAuth flow)
      if (redirectUrl) {
        try {
          const finalUrl = new URL(redirectUrl, window.location.origin);
          const params = new URLSearchParams();
          params.set('access_token', data.accessToken);
          if (data.user?.id) {
            params.set('user_id', data.user.id);
          }
          if (data.user?.email) {
            params.set('email', data.user.email);
          }
          if (data.user?.name) {
            params.set('name', data.user.name);
          }
          finalUrl.search = params.toString();
          window.location.assign(finalUrl.toString());
        } catch {
          // Invalid redirect; default to dashboard
          window.location.assign('/dashboard');
        }
      } else {
        window.location.assign('/dashboard');
      }
    },
    [redirectUrl]
  );

  // Listen for email verification success from verify-email page
  useEffect(() => {
    const unsubscribe = broadcastService.subscribe(
      BroadcastEventType.EMAIL_VERIFIED_SUCCESS,
      (event) => {
        // Email was verified in another tab, redirect with token and user info
        if (event.data?.accessToken) {
          handleSuccessfulAuth({
            accessToken: event.data.accessToken as string,
            user: event.data.user,
          });
        }
      }
    );

    return () => unsubscribe();
  }, [handleSuccessfulAuth]);

  // Fetch available OAuth providers on mount
  useEffect(() => {
    void oauthConfigService
      .getPublicProviders()
      .then((data) => {
        if (data?.data && Array.isArray(data.data)) {
          setAvailableProviders(
            data.data.map((provider) => provider.provider as OAuthProvidersSchema)
          );
        }
      })
      .catch((err: unknown) => console.error('Failed to fetch OAuth providers:', err));
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Validate using Zod schema
    const validationResult = signInFormSchema.safeParse({ email, password });

    if (!validationResult.success) {
      const firstError = validationResult.error.errors[0];
      setError(firstError.message);
      setLoading(false);
      return;
    }

    const validatedData = validationResult.data;

    try {
      const data = await authService.createSession(validatedData);

      if (data.accessToken) {
        handleSuccessfulAuth({
          accessToken: data.accessToken,
          user: data.user,
        });
      }
    } catch (err: unknown) {
      // Check if email verification is required (403 status code)
      if (err instanceof Error && 'response' in err) {
        const apiError = err as { response?: { status: number } };
        if (apiError.response?.status === 403) {
          // User needs to verify email - show verification step
          setStep('awaiting-verification');
          setLoading(false);
          return;
        }
      }
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(code: string) {
    const result = await authService.verifyEmail({
      email,
      otp: code,
    });

    if (result.accessToken) {
      handleSuccessfulAuth({
        accessToken: result.accessToken,
        user: result.user,
      });
    }
  }

  async function handleOAuth(provider: OAuthProvidersSchema) {
    try {
      setOauthLoading(provider);
      setError('');

      // Always provide a redirect_uri (backend requires it)
      // Use the provided redirect URL or default to application root
      const finalRedirectUri = redirectUrl || window.location.origin;

      // Get OAuth authorization URL from backend
      const { authUrl } = await authService.getOAuthUrl(provider, finalRedirectUri);

      // Redirect to OAuth provider's authorization page
      window.location.href = authUrl;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `${provider} sign in failed`);
      setOauthLoading(null);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-gray-50 to-gray-100 dark:from-neutral-900 dark:to-neutral-800">
      <div className="max-w-[400px] w-full flex flex-col items-stretch justify-center bg-white dark:bg-neutral-900 rounded-xl shadow-[0_4px_12px_0_rgba(0,0,0,0.05)]">
        <div className="w-full p-6 flex flex-col items-stretch justify-center gap-6">
          {step === 'form' ? (
            <>
              <div className="flex flex-col items-start justify-center gap-2">
                <h1 className="text-2xl font-semibold text-black dark:text-white">Welcome Back</h1>
                <p className="text-sm text-[#828282]">Login to your account</p>
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

                <AuthPasswordField
                  id="password"
                  label="Password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />

                <AuthSubmitButton isLoading={loading} disabled={loading || oauthLoading !== null}>
                  {loading ? 'Signing in...' : 'Sign In'}
                </AuthSubmitButton>
              </form>

              <p className="text-center text-sm text-gray-600 dark:text-gray-400">
                Don&apos;t have an account?{' '}
                <Link
                  to={`/auth/signup${redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : ''}`}
                  className="text-black dark:text-white font-medium"
                >
                  Sign Up Now
                </Link>
              </p>

              {availableProviders.length > 0 && (
                <>
                  <div className="flex justify-center items-center gap-6 before:content-[''] before:flex-1 before:h-px before:bg-neutral-200 dark:before:bg-neutral-700 after:content-[''] after:flex-1 after:h-px after:bg-neutral-200 dark:after:bg-neutral-700">
                    <span className="text-neutral-400 dark:text-neutral-500 text-sm font-semibold font-manrope">
                      or
                    </span>
                  </div>
                  <AuthOAuthProviders
                    providers={availableProviders}
                    onClick={(provider) => {
                      void handleOAuth(provider);
                    }}
                    disabled={loading || oauthLoading !== null}
                    loading={oauthLoading}
                  />
                </>
              )}
            </>
          ) : (
            <AuthEmailVerificationStep email={email} onVerifyCode={handleVerifyCode} />
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
