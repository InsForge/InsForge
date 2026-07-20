import { CopyButton } from '@insforge/ui';
import { useTranslation } from 'react-i18next';

interface QuickStartPromptCardProps {
  /** Subtitle shown under the "Setup with Prompt" title. */
  subtitle: string;
  /** The text the Copy Prompt button copies. */
  prompt: string;
}

export function QuickStartPromptCard({ subtitle, prompt }: QuickStartPromptCardProps) {
  const { t } = useTranslation('chrome');
  return (
    <section className="flex flex-col gap-3 rounded border border-[var(--alpha-8)] bg-card p-6">
      <span className="w-fit rounded bg-[var(--alpha-8)] px-1.5 py-0.5 text-xs font-medium leading-4 text-primary">
        {t('overview.quickStart', { defaultValue: 'Quick Start' })}
      </span>
      <div className="flex items-center gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <p className="text-base font-medium leading-7 text-foreground">
            {t('overview.setupWithPrompt', { defaultValue: 'Setup with Prompt' })}
          </p>
          <p className="text-sm leading-5 text-muted-foreground">{subtitle}</p>
        </div>
        <CopyButton
          text={prompt}
          showText
          copyText={t('overview.copyPrompt', { defaultValue: 'Copy Prompt' })}
          copiedText={t('common.copied', { defaultValue: 'Copied!' })}
          className="h-9 shrink-0 gap-1.5 rounded bg-primary px-3 text-sm font-medium text-[rgb(var(--inverse))] hover:bg-primary/90"
        />
      </div>
    </section>
  );
}
