import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, CopyButton, Input } from '@insforge/ui';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { useUpdateApifyConfig } from '#features/webscraper/hooks/useWebscraper';
import { APIFY_CONSOLE_URL, SCRAPE_PROMPT } from './shared';

export function ApifyConnectPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation('chrome');
  const { onConnectApify } = useDashboardHost();

  return (
    <div className="flex flex-col self-stretch rounded border border-[var(--alpha-8)] bg-card p-6">
      <StepItem number={1}>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium leading-6 text-foreground">
            {t('webscraper.connectApify', { defaultValue: 'Connect Apify' })}
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            {t('webscraper.connectApifyDescription', {
              defaultValue:
                'Connect your own Apify account so your coding agent can scrape the web on demand.',
            })}
          </p>
        </div>
        {onConnectApify ? (
          <Button
            variant="primary"
            onClick={() => onConnectApify(projectId)}
            className="self-start"
          >
            {t('webscraper.connectApify', { defaultValue: 'Connect Apify' })}
          </Button>
        ) : (
          <ApifyTokenForm />
        )}
      </StepItem>

      <StepItem number={2}>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium leading-6 text-foreground">
            {t('webscraper.scrapeWithPrompt', { defaultValue: 'Scrape with prompt' })}
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            {t('webscraper.scrapePromptHint', {
              defaultValue:
                'Paste this into your coding agent to start a scrape. Replace the placeholder with what you want to scrape.',
            })}
          </p>
        </div>
        <div className="flex flex-col gap-2 rounded border border-[var(--alpha-8)] bg-semantic-1 p-3">
          <div className="flex items-center justify-between">
            <div className="flex h-5 items-center rounded bg-[var(--alpha-8)] px-2">
              <span className="text-xs font-medium leading-4 text-muted-foreground">
                {t('webscraper.scrapePromptLabel', { defaultValue: 'scrape prompt' })}
              </span>
            </div>
            <CopyButton text={SCRAPE_PROMPT} showText={false} className="shrink-0" />
          </div>
          <p className="font-mono text-sm leading-6 text-foreground">{SCRAPE_PROMPT}</p>
        </div>
      </StepItem>
    </div>
  );
}

function StepItem({ number, children }: { number: number; children: ReactNode }) {
  return (
    <div className="flex w-full items-start gap-3">
      <div className="flex flex-col items-center self-stretch">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--alpha-16)] bg-toast text-sm leading-5 text-foreground">
          {number}
        </div>
        <div className="w-px flex-1 bg-[var(--alpha-16)]" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3 pb-6 pl-1">{children}</div>
    </div>
  );
}

function ApifyTokenForm() {
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
