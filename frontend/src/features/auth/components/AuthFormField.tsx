import { Input } from '@/components/radix/Input';
import { Label } from '@/components/radix/Label';
import { cn } from '@/lib/utils/utils';

interface AuthFormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function AuthFormField({ label, id, className, ...props }: AuthFormFieldProps) {
  return (
    <div className={cn('flex flex-col items-stretch justify-center gap-1', className)}>
      {label && (
        <Label htmlFor={id} className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </Label>
      )}
      <Input {...props} id={id} />
    </div>
  );
}
