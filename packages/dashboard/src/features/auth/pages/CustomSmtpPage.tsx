import { useTranslation } from 'react-i18next';
import { useSmtpConfig } from '#features/auth/hooks/useSmtpConfig';
import { SmtpSettingsCard } from '#features/auth/components/SmtpSettingsCard';

export default function CustomSmtpPage() {
  const { t } = useTranslation('chrome');
  const {
    config: smtpConfig,
    isLoading: isSmtpLoading,
    isUpdating: isSmtpUpdating,
    updateConfig: updateSmtpConfig,
  } = useSmtpConfig();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <div className="shrink-0 px-6 pb-6 pt-10 sm:px-10">
        <div className="mx-auto flex w-full max-w-[1024px] items-center justify-between gap-3">
          <h1 className="text-2xl font-medium leading-8 text-foreground">
            {t('auth.customSmtp', { defaultValue: 'Custom SMTP' })}
          </h1>
        </div>
        <div className="mx-auto mt-1 w-full max-w-[1024px]">
          <p className="text-sm text-muted-foreground">
            {t('auth.smtpProviderDescription', {
              defaultValue:
                'Configure a custom SMTP server for sending emails. Your credentials are always encrypted.',
            })}
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10 sm:px-10">
        <div className="mx-auto flex w-full max-w-[1024px] flex-col gap-8">
          <div className="rounded-lg border border-[var(--alpha-8)] bg-card">
            <div className="border-b border-[var(--alpha-8)] px-6 py-4">
              <h2 className="text-base font-medium text-foreground">
                {t('auth.smtpProvider', { defaultValue: 'SMTP Provider' })}
              </h2>
            </div>
            <div className="px-6 py-6">
              <SmtpSettingsCard
                config={smtpConfig}
                isLoading={isSmtpLoading}
                isUpdating={isSmtpUpdating}
                onSave={updateSmtpConfig}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
