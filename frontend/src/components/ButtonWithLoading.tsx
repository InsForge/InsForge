import React from 'react';
import { Button, type ButtonProps } from '@insforge/ui';
import { Loader2 } from 'lucide-react';

interface ButtonWithLoadingProps extends ButtonProps {
  loading?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
}

export function ButtonWithLoading({
  loading = false,
  icon: Icon,
  children,
  disabled,
  ...props
}: ButtonWithLoadingProps) {
  return (
    <Button disabled={disabled || loading} {...props}>
      {loading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : Icon ? (
        <Icon className="mr-2 h-4 w-4" />
      ) : null}
      {children}
    </Button>
  );
}
