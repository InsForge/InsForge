import { ForgotPassword } from '@insforge/react';

export function ForgotPasswordPage() {
  return (
    <ForgotPassword
      onError={(error) => {
        console.error('Failed to send reset code:', error);
      }}
    />
  );
}
