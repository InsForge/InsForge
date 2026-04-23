import { useSmtpConfig } from '../hooks/useSmtpConfig';
import { useResendConfig } from '../hooks/useResendConfig';
import { useEmailTemplates } from '../hooks/useEmailTemplates';
import { SmtpSettingsCard } from '../components/SmtpSettingsCard';
import { ResendSettingsCard } from '../components/ResendSettingsCard';
import { EmailTemplateCard } from '../components/EmailTemplateCard';

export default function EmailPage() {
  const {
    config: smtpConfig,
    isLoading: isSmtpLoading,
    isUpdating: isSmtpUpdating,
    updateConfig: updateSmtpConfig,
  } = useSmtpConfig();
  const {
    config: resendConfig,
    isLoading: isResendLoading,
    isUpdating: isResendUpdating,
    updateConfig: updateResendConfig,
  } = useResendConfig();
  const {
    templates,
    isLoading: isTemplatesLoading,
    isUpdating: isTemplatesUpdating,
    updateTemplate,
  } = useEmailTemplates();

  const hasCustomProvider = smtpConfig?.enabled || resendConfig?.enabled;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <div className="shrink-0 px-6 pb-6 pt-10 sm:px-10">
        <div className="mx-auto flex w-full max-w-[1024px] items-center justify-between gap-3">
          <h1 className="text-2xl font-medium leading-8 text-foreground">Email</h1>
        </div>
        <div className="mx-auto mt-1 w-full max-w-[1024px]">
          <p className="text-sm text-muted-foreground">
            Configure email providers and templates for authentication emails.
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10 sm:px-10">
        <div className="mx-auto flex w-full max-w-[1024px] flex-col gap-8">
          <div className="rounded-lg border border-[var(--alpha-8)] bg-card">
            <div className="border-b border-[var(--alpha-8)] px-6 py-4">
              <h2 className="text-base font-medium text-foreground">Resend</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Send emails using Resend&apos;s API. Just enter your API key &mdash; no SMTP setup
                needed.
              </p>
            </div>
            <div className="px-6 py-6">
              <ResendSettingsCard
                config={resendConfig}
                isLoading={isResendLoading}
                isUpdating={isResendUpdating}
                onSave={updateResendConfig}
              />
            </div>
          </div>

          <div className="rounded-lg border border-[var(--alpha-8)] bg-card">
            <div className="border-b border-[var(--alpha-8)] px-6 py-4">
              <h2 className="text-base font-medium text-foreground">SMTP Provider</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Configure a custom SMTP server for sending emails. Your credentials are always
                encrypted.
              </p>
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

          <fieldset
            disabled={!hasCustomProvider}
            className={`rounded-lg border border-[var(--alpha-8)] bg-card ${!hasCustomProvider ? 'opacity-50' : ''}`}
          >
            <div className="border-b border-[var(--alpha-8)] px-6 py-4">
              <h2 className="text-base font-medium text-foreground">Email Templates</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {hasCustomProvider
                  ? 'Customize the content and appearance of authentication emails.'
                  : 'Enable Resend or custom SMTP above to customize email templates.'}
              </p>
            </div>
            <div className="px-6 py-6">
              <EmailTemplateCard
                templates={templates}
                isLoading={isTemplatesLoading}
                isUpdating={isTemplatesUpdating}
                onSave={(params, options) => updateTemplate(params, options)}
              />
            </div>
          </fieldset>
        </div>
      </div>
    </div>
  );
}
