import { useTranslation } from 'react-i18next';
import { Container, Cloud } from 'lucide-react';
import { EmptyState } from '#components';
import { computeProviderLabel } from '#features/compute/constants';

interface ComputeProviderSetupProps {
  provider: string;
  onOpenSettings: () => void;
}

/**
 * Shown when the selected provider is not configured.
 *
 * Per provider rather than one generic message, because "Docker is not enabled" and
 * "Fly is not enabled" need different steps, and the CTA opens the dialog on the one
 * you were looking at. An empty service list here would read as "you have no
 * services" when the truth is that this provider is not switched on.
 */
export function ComputeProviderSetup({ provider, onOpenSettings }: ComputeProviderSetupProps) {
  const { t } = useTranslation('chrome');
  const label = computeProviderLabel(provider);

  const description =
    provider === 'docker'
      ? t('compute.setupDockerSummary', {
          defaultValue:
            'Run containers on the same Docker daemon as InsForge — no account and no per-container bill. Needs the Docker socket mounted into this container.',
        })
      : t('compute.setupFlySummary', {
          defaultValue:
            'Run containers on Fly.io under your own account, with selectable regions and scale-to-zero. Needs an API token and an org slug.',
        });

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={provider === 'docker' ? Container : Cloud}
          title={t('compute.providerNotEnabled', {
            defaultValue: '{{provider}} is not enabled yet',
            provider: label,
          })}
          description={description}
          action={{
            label: t('compute.providerSetupCta', {
              defaultValue: 'Set up {{provider}}',
              provider: label,
            }),
            onClick: onOpenSettings,
          }}
        />
      </div>
    </div>
  );
}
