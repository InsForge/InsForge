import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@insforge/ui';
import { useUpdateApifyConfig } from '#features/webscraper/hooks/useWebscraper';
import { APIFY_CONSOLE_URL } from './shared';

// The self-hosted "paste your own Apify token" form. Shared by
// `ApifyConnectPanel` (first-time setup from the onboarding checklist) and
// `WebScraperSettingsDialog` (the not-yet-connected state reached via the
// settings dialog) — both need the same input + submit + inline-error
// behavior, so this lives in its own file instead of being duplicated.
export function ApifyTokenForm() {
  const { t } = useTranslation('chrome');
  const [token, setToken] = useState('');
  const { mutateAsync, isPending, error } = useUpdateApifyConfig();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      return;
    }
    try {
      await mutateAsync(trimmed);
      setToken('');
    } catch {
      // Swallowed — the mutation's own `error` state already drives the
      // rendered message below; nothing else to do here.
    }
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex w-full flex-col gap-2">
      <label htmlFor="apify-api-token" className="text-sm leading-6 text-muted-foreground">
        {t('webscraper.apifyTokenLabel', { defaultValue: 'Apify API token' })}
      </label>
      <div className="flex items-start gap-2">
        <Input
          id="apify-api-token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="apify_api_..."
          className="max-w-md"
        />
        <Button type="submit" variant="primary" disabled={!token.trim() || isPending}>
          {isPending
            ? t('webscraper.connecting', { defaultValue: 'Connecting…' })
            : t('webscraper.connectApify', { defaultValue: 'Connect Apify' })}
        </Button>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">
        {t('webscraper.apifyTokenHint', {
          defaultValue:
            'Create a token in the Apify Console under Settings → Integrations. It is stored encrypted on your own backend.',
        })}{' '}
        <a
          href={`${APIFY_CONSOLE_URL}/settings/integrations`}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          {t('webscraper.openApifyConsole', { defaultValue: 'Open Apify Console' })}
        </a>
      </p>
      {error ? (
        <p className="text-sm leading-6 text-destructive">
          {error instanceof Error
            ? error.message
            : t('webscraper.apifyTokenFailed', {
                defaultValue: 'Could not save the token. Check it and try again.',
              })}
        </p>
      ) : null}
    </form>
  );
}
