import { ForgotPassword } from '@insforge/react';

export function ForgotPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-gray-50 to-gray-100 dark:from-neutral-900 dark:to-neutral-800">
      <ForgotPassword
        onError={(error) => {
          console.error('Failed to send reset code:', error);
        }}
      />
    </div>
  );
}
