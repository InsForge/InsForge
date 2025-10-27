import { useState, FormEvent, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  OAuthProvidersSchema,
  OAuthConfigSchema,
  ListOAuthConfigsResponse,
} from '@insforge/shared-schemas';
import { AlertTriangle } from 'lucide-react';
import {
  AuthFormField,
  AuthPasswordField,
  AuthSubmitButton,
  AuthOAuthProviders,
} from '../components';
import InsForgeLogo from '@/assets/logos/insforge_light.svg?react';

export default function SignInPage() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvidersSchema | null>(null);
  const [availableProviders, setAvailableProviders] = useState<OAuthProvidersSchema[]>([]);

  const redirectUrl = searchParams.get('redirect');

  // Fetch available OAuth providers on mount
  useEffect(() => {
    void fetch('/api/auth/oauth/configs')
      .then((res) => res.json())
      .then((data: ListOAuthConfigsResponse) => {
        if (data?.data && Array.isArray(data.data)) {
          setAvailableProviders(
            data.data.map((config: OAuthConfigSchema) => config.provider as OAuthProvidersSchema)
          );
        }
      })
      .catch((err: unknown) => console.error('Failed to fetch OAuth configs:', err));
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error((errorData as { message?: string }).message || 'Sign in failed');
      }

      const { accessToken } = await response.json();

      // Redirect back to user's app with token
      if (redirectUrl) {
        const finalUrl = new URL(redirectUrl);
        finalUrl.searchParams.set('access_token', accessToken);
        window.location.href = finalUrl.toString();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuth(provider: OAuthProvidersSchema) {
    try {
      setOauthLoading(provider);
      setError('');

      // Always provide a redirect_uri (backend requires it)
      // Use the provided redirect URL or default to application root
      const finalRedirectUri = redirectUrl || window.location.origin;
      const apiUrl = `/api/auth/oauth/${provider}?redirect_uri=${encodeURIComponent(finalRedirectUri)}`;

      // Fetch the OAuth URL from backend
      const response = await fetch(apiUrl);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          (errorData as { message?: string }).message || `${provider} OAuth initialization failed`
        );
      }

      const { authUrl } = await response.json();

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
        </div>
        {/* Insforge Branding */}
        <div className="py-4 px-2 flex flex-row items-center justify-center gap-1 bg-neutral-50 font-manrope">
          <p className="text-xs text-black">Secured by</p>
          <a href="https://insforge.dev" target="_blank" rel="noopener noreferrer">
            <InsForgeLogo className="w-21 h-5" />
          </a>
        </div>
      </div>
    </div>
  );
}
