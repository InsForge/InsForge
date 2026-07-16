import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, cn } from '@insforge/ui';
import { Alert, AlertTitle, AlertDescription } from './';

interface ErrorStateProps {
  error: Error | string;
  title?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ error, title, onRetry, className }: ErrorStateProps) {
  const { t } = useTranslation('chrome');
  const errorMessage = error instanceof Error ? error.message : error;

  return (
    <Alert variant="destructive" className={cn('', className)}>
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>
        {title ?? t('common.somethingWentWrong', { defaultValue: 'Something went wrong' })}
      </AlertTitle>
      <AlertDescription className="mt-2">
        <p>{errorMessage}</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="mt-4">
            {t('common.tryAgain', { defaultValue: 'Try again' })}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
