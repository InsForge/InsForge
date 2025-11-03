import { ResetPassword } from '@insforge/react';

export function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-gray-50 to-gray-100 dark:from-neutral-900 dark:to-neutral-800">
      <ResetPassword
        onError={(error) => {
          console.error('Failed to reset password:', error);
        }}
      />
    </div>
  );
}
