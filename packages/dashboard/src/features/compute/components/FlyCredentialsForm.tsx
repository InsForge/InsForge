import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { Button, Input } from '@insforge/ui';
import type { ComputeCredentialStatus } from '@insforge/shared-schemas';
import { useComputeConfig, useUpdateComputeConfig } from '#features/compute/hooks/useComputeConfig';

/**
 * Store Fly credentials from the dashboard instead of the container's environment.
 *
 * Modelled on the Model Gateway credential form: masked placeholder showing what is
 * already stored, reveal toggle, blank means leave alone. Saving takes effect without
 * a restart — the backend refreshes its credential snapshot and rebuilds the provider
 * registry, so a Fly that was unconfigured a moment ago becomes usable.
 *
 * An environment-provided value is shown but cannot be edited away from here: a
 * stored value takes precedence over it, which is what saving does.
 */
export function FlyCredentialsForm() {
  const { t } = useTranslation('chrome');
  const { data: config, isLoading } = useComputeConfig();
  const update = useUpdateComputeConfig();

  const [token, setToken] = useState('');
  const [org, setOrg] = useState('');
  const [revealed, setRevealed] = useState(false);

  const dirty = token.trim().length > 0 || org.trim().length > 0;
  const canSave = dirty && !update.isPending;

  const handleSave = async () => {
    if (!canSave) {
      return;
    }
    try {
      await update.mutateAsync({
        ...(token.trim() ? { flyApiToken: token.trim() } : {}),
        ...(org.trim() ? { flyOrg: org.trim() } : {}),
      });
    } catch {
      // Reported by the mutation's onError. Leaving the fields filled matters: this is
      // a pasted token, and clearing it on failure would make the retry a re-paste.
      return;
    }
    setToken('');
    setOrg('');
    setRevealed(false);
  };

  if (isLoading) {
    return (
      <p className="text-sm leading-6 text-muted-foreground">
        {t('compute.configLoading', { defaultValue: 'Checking stored credentials…' })}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <label
              htmlFor="fly-api-token"
              className="text-sm font-medium leading-5 text-foreground"
            >
              {t('compute.flyApiTokenLabel', { defaultValue: 'API token' })}
            </label>
            <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">
              {t('compute.flyApiTokenHint', {
                defaultValue: 'Org-scoped token from the Fly CLI. Paste the whole line it prints.',
              })}
            </p>
          </div>
          <CredentialBadge status={config?.flyApiToken} />
        </div>
        <div className="relative">
          <Input
            id="fly-api-token"
            type={revealed ? 'text' : 'password'}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={
              config?.flyApiToken.masked ??
              t('compute.flyApiTokenPlaceholder', { defaultValue: 'Paste a Fly API token' })
            }
            autoComplete="off"
            className="pr-10 font-mono"
          />
          <button
            type="button"
            aria-label={
              revealed
                ? t('compute.hideToken', { defaultValue: 'Hide token' })
                : t('compute.showToken', { defaultValue: 'Show token' })
            }
            onClick={() => setRevealed((current) => !current)}
            className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-[var(--alpha-8)] hover:text-foreground"
          >
            {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <label htmlFor="fly-org" className="text-sm font-medium leading-5 text-foreground">
              {t('compute.flyOrgLabel', { defaultValue: 'Organization slug' })}
            </label>
            <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">
              {t('compute.flyOrgHint', {
                defaultValue: 'Your organization’s slug, not its display name.',
              })}
            </p>
          </div>
          <CredentialBadge status={config?.flyOrg} />
        </div>
        <Input
          id="fly-org"
          value={org}
          onChange={(event) => setOrg(event.target.value)}
          placeholder={
            config?.flyOrg.masked ??
            t('compute.flyOrgPlaceholder', { defaultValue: 'your-org-slug' })
          }
          autoComplete="off"
          className="font-mono"
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-[11px] leading-4 text-muted-foreground">
          {t('compute.configReplaceHint', {
            defaultValue: 'Leave a field blank to keep its current value.',
          })}
        </p>
        <Button type="button" onClick={() => void handleSave()} disabled={!canSave}>
          {update.isPending
            ? t('compute.configSaving', { defaultValue: 'Saving…' })
            : t('compute.configSave', { defaultValue: 'Save' })}
        </Button>
      </div>
    </div>
  );
}

/**
 * Where a credential currently comes from. `environment` matters: it tells the
 * operator the value is in the container's env, and that saving here overrides it.
 */
function CredentialBadge({ status }: { status: ComputeCredentialStatus | undefined }) {
  const { t } = useTranslation('chrome');
  if (!status || status.configured) {
    const label =
      status?.source === 'environment'
        ? t('compute.fromEnvironment', { defaultValue: 'From environment' })
        : null;
    return label ? (
      <span className="shrink-0 rounded bg-[var(--alpha-8)] px-2 py-1 text-[11px] leading-4 text-muted-foreground">
        {label}
      </span>
    ) : null;
  }
  return (
    <span className="shrink-0 rounded bg-[var(--alpha-8)] px-2 py-1 text-[11px] leading-4 text-muted-foreground">
      {t('compute.providerNotConfiguredBadge', { defaultValue: 'Not configured' })}
    </span>
  );
}
