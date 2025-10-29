import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/radix/Input';
import { Label } from '@/components/radix/Label';
import { cn } from '@/lib/utils/utils';
import { AuthPasswordStrengthIndicator } from './AuthPasswordStrengthIndicator';
import { PublicEmailAuthConfig } from '@insforge/shared-schemas';

interface AuthPasswordFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  showStrengthIndicator?: boolean;
  passwordConfig?: PublicEmailAuthConfig;
  forgotPasswordLink?: {
    route: string;
    text?: string;
  };
  inputClassName?: string;
}

export function AuthPasswordField({
  label = 'Password',
  id,
  className,
  showStrengthIndicator = false,
  passwordConfig,
  forgotPasswordLink,
  value,
  onFocus,
  inputClassName,
  ...props
}: AuthPasswordFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const navigate = useNavigate();
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
          <Label htmlFor={inputId} className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {label}
          </Label>
        )}
        {forgotPasswordLink && (
          <button
            type="button"
            onClick={() => {
              void navigate(forgotPasswordLink.route);
            }}
            className="text-sm text-[#828282]"
          >
            {forgotPasswordLink.text || 'Forgot password?'}
          </button>
        )}
      </div>
      <div className="relative">
        <Input
          {...props}
          id={inputId}
          type={showPassword ? 'text' : 'password'}
          className={cn('pr-10', inputClassName)}
          value={value}
          onFocus={handleFocus}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          aria-pressed={showPassword}
        >
          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {showStrengthIndicator && showStrength && passwordConfig && (
        <AuthPasswordStrengthIndicator password={String(value || '')} config={passwordConfig} />
      )}
    </div>
  );
}
