import * as React from 'react';
import { ChevronDown, CircleAlert, Info, Search } from 'lucide-react';
import { cn } from '../lib';

interface InputFieldProps extends Omit<React.ComponentProps<'input'>, 'required'> {
  label?: React.ReactNode;
  required?: boolean;
  showLabel?: boolean;
  labelIcon?: React.ReactNode;
  icon?: React.ReactNode;
  showIcon?: boolean;
  showDropdown?: boolean;
  dropdownIcon?: React.ReactNode;
  error?: React.ReactNode;
  showError?: boolean;
  tip?: React.ReactNode;
  showTip?: boolean;
  tipBadge?: React.ReactNode;
  showTipBadge?: boolean;
  showTipIcon?: boolean;
  showErrorIcon?: boolean;
  state?: 'default' | 'hover' | 'pressed' | 'focus' | 'entered' | 'error' | 'disabled';
}

const InputField = React.forwardRef<HTMLInputElement, InputFieldProps>(
  (
    {
      label,
      required,
      showLabel = true,
      labelIcon,
      icon,
      showIcon = true,
      showDropdown = true,
      dropdownIcon,
      error,
      showError = true,
      tip,
      showTip = true,
      tipBadge,
      showTipBadge = true,
      showTipIcon = true,
      showErrorIcon = true,
      state = 'default',
      className,
      disabled,
      placeholder,
      value,
      defaultValue,
      ...props
    },
    ref
  ) => {
    const isDisabled = Boolean(disabled || state === 'disabled');
    const resolvedError = state === 'error' ? (error ?? 'Error Message') : error;
    const isError = Boolean(resolvedError);
    const isHover = state === 'hover';
    const isPressed = state === 'pressed';
    const isForcedFocus = state === 'focus';
    const hasValue =
      (typeof value === 'string' && value.length > 0) ||
      (typeof value === 'number' && !Number.isNaN(value)) ||
      (typeof defaultValue === 'string' && defaultValue.length > 0) ||
      (typeof defaultValue === 'number' && !Number.isNaN(defaultValue));

    const resolvedPlaceholder =
      placeholder ??
      (state === 'focus'
        ? ''
        : state === 'entered' || state === 'error'
          ? 'Entered message here'
          : 'Enter your message here');
    const resolvedLabel = label ?? 'Label';
    const resolvedTip = tip ?? 'Tip Message';

    const leadingIcon = icon ?? (
      <Search
        className={cn(
          'h-5 w-5',
          isDisabled ? 'text-[rgb(var(--disabled))]' : 'text-muted-foreground'
        )}
      />
    );
    const trailingIcon = dropdownIcon ?? (
      <ChevronDown
        className={cn(
          'h-5 w-5',
          isDisabled ? 'text-[rgb(var(--disabled))]' : 'text-muted-foreground'
        )}
      />
    );
    const showFocusCaret = isForcedFocus && !hasValue;

    return (
      <div className={cn('flex w-full flex-col gap-1.5', className)}>
        {showLabel && (
          <label className="flex h-5 items-center gap-1 text-sm leading-5 text-foreground">
            {labelIcon}
            {required && <span className="text-destructive">*</span>}
            {resolvedLabel}
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
            {showFocusCaret && (
              <span className="mx-1 h-5 w-0.5 shrink-0 bg-[rgb(var(--primary))]" />
            )}
            <input
              ref={ref}
              disabled={isDisabled}
              placeholder={resolvedPlaceholder}
              value={value}
              defaultValue={defaultValue}
              className={cn(
                'h-6 min-w-0 flex-1 border-0 bg-transparent px-1 text-sm leading-5 text-foreground outline-none',
                (state === 'entered' || state === 'error') && 'placeholder:text-foreground',
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
        {showError && resolvedError && (
          <div className="flex items-center gap-1">
            {showErrorIcon && <CircleAlert className="h-4 w-4 shrink-0 text-destructive" />}
            <span className="text-[13px] leading-[18px] text-destructive">{resolvedError}</span>
          </div>
        )}
        {showTip && (
          <div className="flex items-center gap-1">
            {showTipIcon && <Info className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <span className="text-[13px] leading-[18px] text-muted-foreground">{resolvedTip}</span>
            {showTipBadge &&
              (tipBadge ?? (
                <span className="rounded px-2 py-0.5 text-xs leading-4 text-muted-foreground bg-[var(--alpha-8)]">
                  Badge
                </span>
              ))}
          </div>
        )}
      </div>
    );
  }
);
InputField.displayName = 'InputField';

export { InputField, type InputFieldProps };
