import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@insforge/ui';
import type { PosthogDiscoveredProject, PosthogRegion } from '@insforge/shared-schemas';
import {
  useListPosthogProjects,
  useUpdatePosthogConfig,
} from '#features/analytics/hooks/useAnalytics';

const POSTHOG_APP_URL: Record<PosthogRegion, string> = {
  US: 'https://us.posthog.com',
  EU: 'https://eu.posthog.com',
};

// The self-hosted "paste your own PostHog key" form, mirroring ApifyTokenForm.
// Cloud projects connect through OAuth instead and never render this.
//
// Submitting discovers before it writes: the key is exercised against PostHog's
// project list first, so an invalid paste fails here rather than producing a
// stored connection that 401s on every dashboard panel. The numeric project id
// and the public phc_ ingestion key come back from that same call, so neither
// has to be copied out of a PostHog URL by hand.
//
// The id is scoped per instance via `useId()` — the connect panel and the
// settings dialog can both be mounted at once, and a hardcoded id would collide
// and break `getByLabelText`-style queries as well as accessibility.
export function PosthogKeyForm() {
  const { t } = useTranslation('chrome');
  const keyInputId = useId();
  const [personalApiKey, setPersonalApiKey] = useState('');
  const [region, setRegion] = useState<PosthogRegion>('US');
  // Only populated when the key can see more than one project — otherwise the
  // single match is connected without ever showing a picker.
  const [choices, setChoices] = useState<PosthogDiscoveredProject[]>([]);
  const [chosenId, setChosenId] = useState('');

  const discover = useListPosthogProjects();
  const connect = useUpdatePosthogConfig();

  const isPending = discover.isPending || connect.isPending;
  const error = discover.error ?? connect.error;

  const reset = () => {
    setPersonalApiKey('');
    setChoices([]);
    setChosenId('');
    // Mutations retain their variables — the raw key — after settling; drop
    // them once the credential is stored server-side.
    discover.reset();
    connect.reset();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = personalApiKey.trim();
    if (!trimmed) {
      return;
    }
    try {
      // Second pass: the picker is already showing and a project is selected.
      if (choices.length > 0) {
        if (!chosenId) {
          return;
        }
        await connect.mutateAsync({
          personalApiKey: trimmed,
          region,
          posthogProjectId: chosenId,
        });
        reset();
        return;
      }

      const projects = await discover.mutateAsync({ personalApiKey: trimmed, region });
      // Zero projects: hand the key to connect anyway — the backend rejects it
      // with an actionable scopes message that renders in the error block below,
      // instead of the form silently doing nothing.
      if (projects.length <= 1) {
        await connect.mutateAsync({ personalApiKey: trimmed, region });
        reset();
        return;
      }
      // Ambiguous — show the picker rather than guessing, which would silently
      // wire the dashboard to the wrong product's data.
      setChoices(projects);
    } catch {
      // Swallowed — the mutation's own `error` state drives the message below.
    }
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex w-full flex-col gap-2">
      <label htmlFor={keyInputId} className="text-sm leading-6 text-muted-foreground">
        {t('analytics.posthogKeyLabel', { defaultValue: 'PostHog personal API key' })}
      </label>
      <div className="flex items-start gap-2">
        <Input
          id={keyInputId}
          type="password"
          autoComplete="off"
          value={personalApiKey}
          onChange={(event) => {
            setPersonalApiKey(event.target.value);
            // Editing the key invalidates a picker built from the previous one.
            if (choices.length > 0) {
              setChoices([]);
              setChosenId('');
            }
          }}
          placeholder="phx_..."
          className="min-w-0 max-w-md flex-1"
        />
        <Select
          value={region}
          onValueChange={(value) => {
            setRegion(value as PosthogRegion);
            setChoices([]);
            setChosenId('');
          }}
        >
          <SelectTrigger className="w-28 shrink-0" aria-label="PostHog region">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="US">US</SelectItem>
            <SelectItem value="EU">EU</SelectItem>
          </SelectContent>
        </Select>
        {choices.length === 0 ? (
          <Button
            type="submit"
            variant="primary"
            className="shrink-0"
            disabled={!personalApiKey.trim() || isPending}
          >
            {isPending
              ? t('analytics.connecting', { defaultValue: 'Connecting…' })
              : t('analytics.connectPosthog', { defaultValue: 'Connect PostHog' })}
          </Button>
        ) : null}
      </div>

      {choices.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-6 text-muted-foreground">
            {t('analytics.posthogPickProject', {
              defaultValue: 'This key can see several PostHog projects. Choose one:',
            })}
          </p>
          <div className="flex items-start gap-2">
            <Select value={chosenId} onValueChange={setChosenId}>
              <SelectTrigger className="min-w-0 max-w-md flex-1" aria-label="PostHog project">
                <SelectValue
                  placeholder={t('analytics.posthogChooseProject', {
                    defaultValue: 'Choose a project…',
                  })}
                />
              </SelectTrigger>
              <SelectContent>
                {choices.map((project) => (
                  <SelectItem key={project.posthogProjectId} value={project.posthogProjectId}>
                    {project.organizationName
                      ? `${project.organizationName} / ${project.name}`
                      : project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* The submit lives beside the picker in this phase — the next
                action sits next to the control that unlocks it. */}
            <Button
              type="submit"
              variant="primary"
              className="shrink-0"
              disabled={!chosenId || isPending}
            >
              {isPending
                ? t('analytics.connecting', { defaultValue: 'Connecting…' })
                : t('analytics.connectPosthog', { defaultValue: 'Connect PostHog' })}
            </Button>
          </div>
        </div>
      ) : null}

      <p className="text-sm leading-6 text-muted-foreground">
        {t('analytics.posthogKeyHint', {
          defaultValue:
            'Create a key in PostHog under Settings → Personal API keys, with read access to organizations, projects and queries (plus session recording read and sharing write for replays). It is stored encrypted on your own backend.',
        })}{' '}
        <a
          href={`${POSTHOG_APP_URL[region]}/settings/user-api-keys`}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          {t('analytics.openPosthogSettings', { defaultValue: 'Open PostHog settings' })}
        </a>
      </p>

      {error ? (
        // Announced, not just rendered: this is the only feedback a failed
        // submission gives and it arrives after the fact. role="alert" already
        // implies aria-live="assertive", so aria-atomic is paired with it rather
        // than a second aria-live, which would double-announce in VoiceOver.
        <p role="alert" aria-atomic="true" className="text-sm leading-6 text-destructive">
          {error instanceof Error
            ? error.message
            : t('analytics.posthogKeyFailed', {
                defaultValue: 'Could not save the key. Check it and try again.',
              })}
        </p>
      ) : null}
    </form>
  );
}
