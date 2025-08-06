import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/radix/Button';
import { Alert, AlertDescription, AlertTitle } from '@/components/radix/Alert';
import { cn } from '@/lib/utils/utils';

interface ErrorStateProps {
  error: Error | string;
  title?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  error,
  title = 'Something went wrong',
  onRetry,
  className,
}: ErrorStateProps) {
  const errorMessage = error instanceof Error ? error.message : error;

  return (
    <Alert variant="destructive" className={cn('', className)}>
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="mt-2">
        <p>{errorMessage}</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="mt-4">
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
