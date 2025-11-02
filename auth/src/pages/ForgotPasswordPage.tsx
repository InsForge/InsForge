import { useSearchParams } from 'react-router-dom';
import { ForgotPassword } from '@insforge/react';
import { AuthRouterPath } from '@/App';

export function ForgotPasswordPage() {
  const [searchParams] = useSearchParams();

  const redirectUrl = searchParams.get('redirect');
  const backToSignInUrl = `${AuthRouterPath.SIGN_IN}${redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : ''}`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-gray-50 to-gray-100 dark:from-neutral-900 dark:to-neutral-800">
      <ForgotPassword
        backToSignInUrl={backToSignInUrl}
        onError={(error) => {
          console.error('Failed to send reset code:', error);
        }}
      />
    </div>
  );
}
