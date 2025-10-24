import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/radix/Input';
import { Label } from '@/components/radix/Label';
import { cn } from '@/lib/utils/utils';
import { AuthPasswordStrengthIndicator } from './AuthPasswordStrengthIndicator';

interface AuthPasswordFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  showStrengthIndicator?: boolean;
  forgotPasswordLink?: {
    href: string;
    text?: string;
  };
}

export function AuthPasswordField({
  label = 'Password',
  id,
  className,
  showStrengthIndicator = false,
  forgotPasswordLink,
  value,
  onFocus,
  ...props
}: AuthPasswordFieldProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showStrength, setShowStrength] = useState(false);

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    if (showStrengthIndicator) {
      setShowStrength(true);
    }
    onFocus?.(e);
  };

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center justify-between">
        {label && (
          <Label htmlFor={id} className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {label}
          </Label>
        )}
        {forgotPasswordLink && (
          <a href={forgotPasswordLink.href} className="text-sm text-[#828282]">
            {forgotPasswordLink.text || 'Forgot password?'}
          </a>
        )}
      </div>
      <div className="relative">
        <Input
          {...props}
          id={id}
          type={showPassword ? 'text' : 'password'}
          className="pr-10"
          value={value}
          onFocus={handleFocus}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          aria-label={showPassword ? 'Hide password' : 'Show password'}
        >
          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {showStrengthIndicator && showStrength && (
        <AuthPasswordStrengthIndicator password={String(value || '')} />
      )}
    </div>
  );
}
