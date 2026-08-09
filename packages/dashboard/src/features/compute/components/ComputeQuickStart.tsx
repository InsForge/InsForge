import { useTranslation } from 'react-i18next';
import { Container, Cloud, Settings } from 'lucide-react';
import { Button } from '@insforge/ui';

interface ComputeQuickStartProps {
  onOpenSettings: () => void;
}

/**
 * Content-area quick start for a deployment with no compute provider configured.
 *
 * Sits beside the secondary nav rather than replacing the page, so the tab still
 * looks like the compute tab — the sub-menu stays visible with its entries disabled,
 * which is how the payments tab handles the same state.
 *
 * The detail lives in the settings dialog; this panel's job is to say what the two
 * options are and give one obvious way in. A bare shell command dropped on the page
 * is not a setup flow.
 */
export function ComputeQuickStart({ onOpenSettings }: ComputeQuickStartProps) {
  const { t } = useTranslation('chrome');

  const options = [
    {
      id: 'docker',
      icon: Container,
      title: t('compute.setupDockerTitle', { defaultValue: 'Your own Docker host' }),
      body: t('compute.setupDockerSummary', {
        defaultValue:
          'Containers run next to InsForge on the same daemon. No account, no per-container bill. Needs the Docker socket mounted into this container.',
      }),
    },
    {
      id: 'fly',
      icon: Cloud,
      title: t('compute.setupFlyTitle', { defaultValue: 'Fly.io' }),
      body: t('compute.setupFlySummary', {
        defaultValue:
          'Containers run under your own Fly account, with selectable regions and scale-to-zero. Needs an API token and an org slug.',
      }),
    },
  ];

  return (
    <div className="h-full overflow-auto px-6 py-6">
      <div className="max-w-3xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-base font-medium text-foreground">
            {t('compute.quickStartTitle', { defaultValue: 'Run containers next to your project' })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('compute.quickStartSubtitle', {
              defaultValue:
                'Compute is not enabled yet. Choose where containers should run, then restart InsForge.',
            })}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {options.map((option) => (
            <div
              key={option.id}
              className="rounded-lg border border-[var(--alpha-8)] p-4 space-y-2"
            >
              <div className="flex items-center gap-2">
                <option.icon className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium text-foreground">{option.title}</h3>
              </div>
              <p className="text-xs text-muted-foreground">{option.body}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Button variant="primary" size="lg" onClick={onOpenSettings}>
            <Settings className="mr-2 h-4 w-4" />
            {t('compute.quickStartCta', { defaultValue: 'Set up compute' })}
          </Button>
          <a
            href="https://docs.insforge.dev/core-concepts/compute/overview"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            {t('compute.setupDocsLink', { defaultValue: 'Read the setup guide' })}
          </a>
        </div>
      </div>
    </div>
  );
}
