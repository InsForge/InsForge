import { ResetPassword } from '@insforge/react';

export function ResetPasswordPage() {
  return (
    <ResetPassword
      onError={(error) => {
        console.error('Failed to reset password:', error);
      }}
    />
  );
}
