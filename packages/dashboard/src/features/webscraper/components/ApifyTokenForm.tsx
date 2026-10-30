import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@insforge/ui';
import { useUpdateApifyConfig } from '#features/webscraper/hooks/useWebscraper';
import { APIFY_CONSOLE_URL } from './shared';

// The self-hosted "paste your own Apify token" form. Shared by
// `ApifyConnectPanel` (first-time setup from the onboarding checklist),
// `WebScraperSettingsDialog` (the not-yet-connected state reached via the
// settings dialog) and `WebscraperLayout`'s revoked/degraded banner (where
// replacing the token is the only remedy off-cloud) — all three need the same
// input + submit + inline-error behavior, so this lives in its own file
// instead of being duplicated.
//
// More than one of these three call sites can be mounted at the same time
// (e.g. the settings dialog overlays the connect panel rather than replacing
// it), so the input's id is scoped per instance via `useId()` — matching the
// precedent in `CreateBackupDialog.tsx`/`RenameBackupDialog.tsx` — instead of
// a hardcoded id, which would collide and break both accessibility and
// `getByLabelText`-style queries whenever more than one instance is on screen.
export function ApifyTokenForm() {
  const { t } = useTranslation('chrome');
  const tokenInputId = useId();
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
      <label htmlFor={tokenInputId} className="text-sm leading-6 text-muted-foreground">
        {t('webscraper.apifyTokenLabel', { defaultValue: 'Apify API token' })}
      </label>
      <div className="flex items-start gap-2">
        <Input
          id={tokenInputId}
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
        // Announced, not just rendered: this message is the only feedback a
        // failed submission gives, and it appears after the fact. role="alert"
        // already implies aria-live="assertive", so pairing it with an explicit
        // aria-live both contradicts that and double-announces in VoiceOver on
        // iOS — aria-atomic instead, per W3C ARIA19 for form errors.
        <p role="alert" aria-atomic="true" className="text-sm leading-6 text-destructive">
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
