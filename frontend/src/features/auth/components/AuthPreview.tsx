import { useState, useEffect } from 'react';
import { SignInForm, SignUpForm, ForgotPasswordForm } from '@insforge/react';
import { useAuthConfig } from '../hooks/useAuthConfig';
import { useOAuthConfig } from '../hooks/useOAuthConfig';

type AuthView = 'sign-in' | 'sign-up' | 'forgot-password';

export function AuthPreview() {
  const { config } = useAuthConfig();
  const { configs: oAuthConfigs } = useOAuthConfig();
  const [view, setView] = useState<AuthView>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Listen to hash changes
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1); // Remove the #
      if (
        hash === 'preview=sign-in' ||
        hash === 'preview=sign-up' ||
        hash === 'preview=forgot-password'
      ) {
        setView(hash.replace('preview=', '') as AuthView);
      }
    };

    // Set initial view from hash
    handleHashChange();

    // Listen for hash changes
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const authConfig = {
    oAuthProviders: oAuthConfigs.map((provider) => provider.provider) ?? [],
    passwordMinLength: config?.passwordMinLength ?? 6,
    requireEmailVerification: !!config?.requireEmailVerification,
    requireLowercase: !!config?.requireLowercase,
    requireNumber: !!config?.requireNumber,
    requireSpecialChar: !!config?.requireSpecialChar,
    requireUppercase: !!config?.requireUppercase,
    resetPasswordMethod: config?.resetPasswordMethod ?? ('code' as const),
    verifyEmailMethod: config?.verifyEmailMethod ?? ('code' as const),
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Preview mode - do nothing
  };

  const handleOAuthClick = () => {
    // Preview mode - do nothing
  };

  return (
    <div className="w-[400px]">
      {view === 'sign-in' && (
        <SignInForm
          email={email}
          password={password}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
          onSubmit={handleSubmit}
          authConfig={authConfig}
          onOAuthClick={handleOAuthClick}
          forgotPasswordUrl="#preview=forgot-password"
          signUpUrl="#preview=sign-up"
        />
      )}

      {view === 'sign-up' && (
        <SignUpForm
          email={email}
          password={password}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
          onSubmit={handleSubmit}
          authConfig={authConfig}
          onOAuthClick={handleOAuthClick}
          signInUrl="#preview=sign-in"
        />
      )}

      {view === 'forgot-password' && (
        <ForgotPasswordForm
          email={email}
          onEmailChange={setEmail}
          onSubmit={handleSubmit}
          backToSignInUrl="#preview=sign-in"
        />
      )}
    </div>
  );
}
