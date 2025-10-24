import { Loader2 } from 'lucide-react';
import { Button } from '@/components/radix/Button';
import { cn } from '@/lib/utils/utils';

interface AuthSubmitButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isLoading?: boolean;
  children: React.ReactNode;
}

export function AuthSubmitButton({
  isLoading,
  children,
  className,
  disabled,
  ...props
}: AuthSubmitButtonProps) {
  return (
    <Button
      {...props}
      type="submit"
      disabled={disabled || isLoading}
      className={cn(
        'mt-4 px-4 py-2 rounded w-full h-10 bg-black hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-200 dark:text-black',
        className
      )}
    >
      {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </Button>
  );
}
