import { CopyButton } from '@insforge/ui';
import { cn } from '#lib/utils/utils';

interface CredentialRowProps {
  label: string;
  value: string;
  isLoading?: boolean;
}

function CredentialRow({ label, value, isLoading = false }: CredentialRowProps) {
  return (
    <div className="flex items-center gap-4 min-w-0">
      <span className="w-25 shrink-0 text-sm leading-6 text-foreground">{label}</span>
      <div
        className={cn(
          'flex h-9 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-[var(--alpha-8)] bg-semantic-0 px-3 py-2',
          isLoading && 'animate-pulse'
        )}
      >
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{value}</span>
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
      <p className="text-base leading-7 text-muted-foreground">
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
