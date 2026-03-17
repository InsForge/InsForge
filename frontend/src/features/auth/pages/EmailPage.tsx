import { useSmtpConfig } from '@/features/auth/hooks/useSmtpConfig';
import { useEmailTemplates } from '@/features/auth/hooks/useEmailTemplates';
import { SmtpSettingsCard } from '@/features/auth/components/SmtpSettingsCard';
import { EmailTemplateCard } from '@/features/auth/components/EmailTemplateCard';

export default function EmailPage() {
  const {
    config: smtpConfig,
    isLoading: isSmtpLoading,
    isUpdating: isSmtpUpdating,
    updateConfig: updateSmtpConfig,
  } = useSmtpConfig();
  const {
    templates,
    isLoading: isTemplatesLoading,
    isUpdating: isTemplatesUpdating,
    updateTemplate,
  } = useEmailTemplates();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <div className="shrink-0 px-6 pb-6 pt-10 sm:px-10">
        <div className="mx-auto flex w-full max-w-[1024px] items-center justify-between gap-3">
          <h1 className="text-2xl font-medium leading-8 text-foreground">Email</h1>
        </div>
        <div className="mx-auto mt-1 w-full max-w-[1024px]">
          <p className="text-sm text-muted-foreground">
            Configure custom SMTP settings and email templates for authentication emails.
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 sm:px-10">
        <div className="mx-auto flex w-full max-w-[1024px] flex-col gap-6">
          <SmtpSettingsCard
            config={smtpConfig}
            isLoading={isSmtpLoading}
            isUpdating={isSmtpUpdating}
            onSave={updateSmtpConfig}
          />
          <div className="border-t border-border" />
          <EmailTemplateCard
            templates={templates}
            isLoading={isTemplatesLoading}
            isUpdating={isTemplatesUpdating}
            onSave={updateTemplate}
          />
        </div>
      </div>
    </div>
  );
}
