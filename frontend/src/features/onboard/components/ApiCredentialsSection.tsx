import { CopyButton } from '@/components';
import { cn } from '@/lib/utils/utils';

interface CredentialRowProps {
  label: string;
  value: string;
  isLoading?: boolean;
}

function CredentialRow({ label, value, isLoading = false }: CredentialRowProps) {
  return (
    <div className="flex items-center gap-4 min-w-0">
      <span className="text-gray-500 dark:text-neutral-400 text-sm w-24 shrink-0">{label}</span>
      <div
        className={cn(
          'flex-1 min-w-0 flex items-center justify-between gap-2 bg-gray-100 dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded px-3 py-2',
          isLoading && 'animate-pulse'
        )}
      >
        <span className="text-gray-700 dark:text-neutral-300 text-sm truncate min-w-0 flex-1">
          {value}
        </span>
        <CopyButton
          text={value}
          disabled={isLoading}
          showText={false}
          className="h-6 w-6 p-1 bg-white dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 border-none rounded-md shadow-sm min-w-0 shrink-0 text-black dark:text-white"
        />
      </div>
    </div>
  );
}

interface ApiCredentialsSectionProps {
  apiKey: string;
  appUrl: string;
  isLoading?: boolean;
  className?: string;
}

export function ApiCredentialsSection({
  apiKey,
  appUrl,
  isLoading = false,
  className,
}: ApiCredentialsSectionProps) {
  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <p className="text-gray-500 dark:text-neutral-400 text-base leading-7">
        Use the project URL and API key to connect directly via REST API or any HTTP client.
      </p>

      <div className="flex flex-col gap-4">
        <CredentialRow label="Project URL" value={appUrl} isLoading={isLoading} />
        <CredentialRow label="API Key" value={apiKey} isLoading={isLoading} />
      </div>
    </div>
  );
}
