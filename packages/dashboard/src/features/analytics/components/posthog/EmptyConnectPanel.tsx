import { useTranslation } from 'react-i18next';
import { Button, CopyButton } from '@insforge/ui';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { ANALYTICS_SETUP_PROMPT } from '#features/analytics/lib/constants';

export function EmptyConnectPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation('chrome');
  const { onConnectPosthog } = useDashboardHost();

  return (
    <div className="flex flex-col self-stretch rounded border border-[var(--alpha-8)] bg-card p-6">
      <StepItem number={1}>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium leading-6 text-foreground">
            {t('analytics.connectPosthog', { defaultValue: 'Connect PostHog' })}
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            {t('analytics.connectPosthogDescription', {
              defaultValue: 'One-click setup of a PostHog project for product analytics.',
            })}
          </p>
        </div>
        <Button
          variant="primary"
          disabled={!onConnectPosthog}
          onClick={() => onConnectPosthog?.(projectId)}
          className="self-start"
        >
          {t('analytics.connectPosthog', { defaultValue: 'Connect PostHog' })}
        </Button>
      </StepItem>

      <StepItem number={2}>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium leading-6 text-foreground">
            {t('analytics.setupWithPrompt', { defaultValue: 'Setup with prompt' })}
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            {t('analytics.setupPromptDescription', {
              defaultValue:
                'Paste this into your coding agent to set up PostHog analytics for your app',
            })}
          </p>
        </div>
        <div className="flex flex-col gap-2 rounded border border-[var(--alpha-8)] bg-semantic-1 p-3">
          <div className="flex items-center justify-between">
            <div className="flex h-5 items-center rounded bg-[var(--alpha-8)] px-2">
              <span className="text-xs font-medium leading-4 text-muted-foreground">
                {t('analytics.setupPromptBadge', { defaultValue: 'setup prompt' })}
              </span>
            </div>
            <CopyButton text={ANALYTICS_SETUP_PROMPT} showText={false} className="shrink-0" />
          </div>
          <p className="font-mono text-sm leading-6 text-foreground">{ANALYTICS_SETUP_PROMPT}</p>
        </div>
      </StepItem>
    </div>
  );
}

function StepItem({ number, children }: { number: number; children: React.ReactNode }) {
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
