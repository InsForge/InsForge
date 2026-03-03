import { CopyButton } from '@insforge/ui';
import { cn } from '@/lib/utils/utils';

interface CredentialRowProps {
  label: string;
  value: string;
  isLoading?: boolean;
}

function CredentialRow({ label, value, isLoading = false }: CredentialRowProps) {
  return (
    <div className="flex items-center gap-4 min-w-0">
      <span className="text-gray-900 dark:text-white text-sm leading-6 w-25 shrink-0">{label}</span>
      <div
        className={cn(
          'flex-1 h-9 min-w-0 flex items-center justify-between gap-2 bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded-lg px-3 py-2',
          isLoading && 'animate-pulse'
        )}
      >
        <span className="text-gray-900 dark:text-white text-sm truncate min-w-0 flex-1">
          {value}
        </span>
        <CopyButton text={value} disabled={isLoading} showText={false} className="shrink-0" />
      </div>
    </div>
  );
}

interface APIKeysSectionProps {
  apiKey: string;
  anonKey: string;
  appUrl: string;
  isLoading?: boolean;
  className?: string;
}

export function APIKeysSection({
  apiKey,
  anonKey,
  appUrl,
  isLoading = false,
  className,
}: APIKeysSectionProps) {
  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <p className="text-gray-500 dark:text-neutral-400 text-base leading-7">
        Use the project URL and API key to connect directly via REST API or any HTTP client.
      </p>

      <div className="flex flex-col gap-4">
        <CredentialRow label="Project URL" value={appUrl} isLoading={isLoading} />
        <CredentialRow label="API Key" value={apiKey} isLoading={isLoading} />
        <CredentialRow label="Anon Key" value={anonKey} isLoading={isLoading} />
      </div>
    </div>
  );
}
