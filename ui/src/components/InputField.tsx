import * as React from 'react';
import { ChevronDown, CircleAlert, Info, Search } from 'lucide-react';
import { cn } from '../lib';

interface InputFieldProps extends React.ComponentProps<'input'> {
  label?: string;
  required?: boolean;
  labelIcon?: React.ReactNode;
  icon?: React.ReactNode;
  showIcon?: boolean;
  showDropdown?: boolean;
  dropdownIcon?: React.ReactNode;
  error?: string;
  tip?: string;
  tipBadge?: React.ReactNode;
  showTipIcon?: boolean;
  showErrorIcon?: boolean;
  state?: 'default' | 'hover' | 'pressed' | 'focus' | 'entered' | 'error' | 'disabled';
}

const InputField = React.forwardRef<HTMLInputElement, InputFieldProps>(
  (
    {
      label,
      required,
      labelIcon,
      icon,
      showIcon = true,
      showDropdown = true,
      dropdownIcon,
      error,
      tip,
      tipBadge,
      showTipIcon = true,
      showErrorIcon = true,
      state = 'default',
      className,
      disabled,
      placeholder = 'Enter your message here',
      ...props
    },
    ref
  ) => {
    const isDisabled = Boolean(disabled || state === 'disabled');
    const isError = Boolean(error || state === 'error');
    const isHover = state === 'hover';
    const isPressed = state === 'pressed';
    const isForcedFocus = state === 'focus';

    const leadingIcon = icon ?? <Search className="h-5 w-5 text-muted-foreground" />;
    const trailingIcon = dropdownIcon ?? <ChevronDown className="h-5 w-5 text-muted-foreground" />;

    return (
      <div className={cn('flex w-full flex-col gap-1.5', className)}>
        {label && (
          <label className="flex h-5 items-center gap-1 text-sm leading-5 text-foreground">
            {labelIcon}
            {required && <span className="text-destructive">*</span>}
            {label}
          </label>
        )}
        <div
          className={cn(
            'rounded border border-[var(--alpha-12)] bg-[var(--alpha-4)] transition-colors',
            isError && 'border-destructive',
            !isDisabled &&
              'focus-within:shadow-[0_0_0_1px_rgb(var(--inverse)),0_0_0_2px_rgb(var(--foreground))]',
            isForcedFocus &&
              'shadow-[0_0_0_1px_rgb(var(--inverse)),0_0_0_2px_rgb(var(--foreground))]'
          )}
        >
          <div
            className={cn(
              'flex items-center gap-0 overflow-hidden rounded p-1.5',
              !isDisabled &&
                !isHover &&
                !isPressed &&
                'hover:bg-[var(--alpha-8)] active:bg-[var(--alpha-16)]',
              isHover && 'bg-[var(--alpha-8)]',
              isPressed && 'bg-[var(--alpha-16)]'
            )}
          >
            {showIcon && (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center">{leadingIcon}</div>
            )}
            <input
              ref={ref}
              disabled={isDisabled}
              placeholder={placeholder}
              className={cn(
                'h-6 min-w-0 flex-1 border-0 bg-transparent px-1 text-sm leading-5 text-foreground outline-none',
                'placeholder:text-muted-foreground disabled:text-[rgb(var(--disabled))]'
              )}
              {...props}
            />
            {showDropdown && (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center">
                {trailingIcon}
              </div>
            )}
          </div>
        </div>
        {error && (
          <div className="flex items-center gap-1">
            {showErrorIcon && <CircleAlert className="h-4 w-4 shrink-0 text-destructive" />}
            <span className="text-[13px] leading-[18px] text-destructive">{error}</span>
          </div>
        )}
        {tip && (
          <div className="flex items-center gap-1">
            {showTipIcon && <Info className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <span className="text-[13px] leading-[18px] text-muted-foreground">{tip}</span>
            {tipBadge}
          </div>
        )}
      </div>
    );
  }
);
InputField.displayName = 'InputField';

export { InputField, type InputFieldProps };
