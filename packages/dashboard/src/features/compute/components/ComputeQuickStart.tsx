import { useTranslation } from 'react-i18next';
import { Server } from 'lucide-react';
import { EmptyState } from '#components';

interface ComputeQuickStartProps {
  onOpenSettings: () => void;
}

/**
 * Content-area state for a deployment with no compute provider configured.
 *
 * Uses the shared EmptyState, whose `action` is exactly the CTA this needs, rather
 * than a hand-built panel. The step-by-step detail lives in the settings dialog the
 * action opens — putting compose YAML and shell commands on the page itself is what
 * made the first attempt look wrong.
 *
 * The sidebar stays mounted around this with its entries disabled, so the tab reads
 * as unconfigured rather than broken.
 */
export function ComputeQuickStart({ onOpenSettings }: ComputeQuickStartProps) {
  const { t } = useTranslation('chrome');

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={Server}
          title={t('compute.quickStartTitle', { defaultValue: 'Compute is not enabled yet' })}
          description={t('compute.quickStartSubtitle', {
            defaultValue:
              'Run containers on your own Docker host, or on Fly.io under your own account. Either takes two settings and a restart.',
          })}
          action={{
            label: t('compute.quickStartCta', { defaultValue: 'Set up compute' }),
            onClick: onOpenSettings,
          }}
        />
      </div>
    </div>
  );
}
