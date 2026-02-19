import * as React from 'react';
import { CircleAlert, Info } from 'lucide-react';
import { cn } from '../lib';
import { Input } from './Input';

interface InputFieldProps extends React.ComponentProps<'input'> {
  label?: string;
  required?: boolean;
  labelIcon?: React.ReactNode;
  error?: string;
  tip?: string;
  tipBadge?: React.ReactNode;
}

const InputField = React.forwardRef<HTMLInputElement, InputFieldProps>(
  ({ label, required, labelIcon, error, tip, tipBadge, className, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="flex items-center gap-1 text-sm leading-5 text-foreground">
            {labelIcon}
            {label}
            {required && <span className="text-destructive">*</span>}
          </label>
        )}
        <Input ref={ref} className={cn(error && 'border-destructive', className)} {...props} />
        {error && (
          <div className="flex items-center gap-1">
            <CircleAlert className="h-4 w-4 shrink-0 text-destructive" />
            <span className="text-[13px] leading-[18px] text-destructive">{error}</span>
          </div>
        )}
        {tip && !error && (
          <div className="flex items-center gap-1">
            <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
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
