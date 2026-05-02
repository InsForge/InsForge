import { CopyButton } from '@insforge/ui';
import { cn } from '#lib/utils/utils';
import { type ReactNode } from 'react';
import LinkChainIcon from '#assets/icons/link_chain.svg?react';
import KeyHorizontalIcon from '#assets/icons/key_horizontal.svg?react';

interface CredentialRowProps {
  icon: ReactNode;
  label: string;
  value: string;
  isLoading?: boolean;
}

function CredentialRow({ icon, label, value, isLoading = false }: CredentialRowProps) {
  return (
    <div className="flex items-center gap-6">
      <div className="flex w-[240px] shrink-0 items-center gap-2">
        <span className="text-foreground">{icon}</span>
        <span className="text-sm font-medium leading-6 text-foreground">{label}</span>
      </div>
      <div
        className={cn(
          'flex min-w-0 flex-1 items-center rounded border border-[var(--alpha-8)] bg-semantic-0 p-1.5',
          isLoading && 'animate-pulse'
        )}
      >
        <span className="min-w-0 flex-1 truncate px-1 text-sm leading-5 text-foreground">
          {value}
        </span>
        <CopyButton text={value} disabled={isLoading} showText={false} className="shrink-0" />
      </div>
    </div>
  );
}

interface APIKeysSectionV2Props {
  apiKey: string;
  anonKey: string;
  appUrl: string;
  isLoading?: boolean;
  className?: string;
}

export function APIKeysSectionV2({
  apiKey,
  anonKey,
  appUrl,
  isLoading = false,
  className,
}: APIKeysSectionV2Props) {
  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <CredentialRow
        icon={<LinkChainIcon className="size-5 text-muted-foreground" />}
        label="Project URL"
        value={appUrl}
        isLoading={isLoading}
      />
      <CredentialRow
        icon={<KeyHorizontalIcon className="size-5 text-muted-foreground" />}
        label="API Key"
        value={apiKey}
        isLoading={isLoading}
      />
      <CredentialRow
        icon={<KeyHorizontalIcon className="size-5 text-muted-foreground" />}
        label="Anon Key"
        value={anonKey}
        isLoading={isLoading}
      />
    </div>
  );
}
