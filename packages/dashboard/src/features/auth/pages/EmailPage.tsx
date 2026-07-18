import { useTranslation } from 'react-i18next';
import { useEmailTemplates } from '#features/auth/hooks/useEmailTemplates';
import { EmailTemplateCard } from '#features/auth/components/EmailTemplateCard';

export default function EmailPage() {
  const { t } = useTranslation('chrome');
  const {
    templates,
    isLoading: isTemplatesLoading,
    isUpdating: isTemplatesUpdating,
    updateTemplate,
  } = useEmailTemplates('default');

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <div className="shrink-0 px-6 pb-6 pt-10 sm:px-10">
        <div className="mx-auto flex w-full max-w-[1024px] items-center justify-between gap-3">
          <h1 className="text-2xl font-medium leading-8 text-foreground">
            {t('auth.email', { defaultValue: 'Email' })}
          </h1>
        </div>
        <div className="mx-auto mt-1 w-full max-w-[1024px]">
          <p className="text-sm text-muted-foreground">
            {t('auth.emailPageDescription', {
              defaultValue:
                'Configure your authentication email templates.',
            })}
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10 sm:px-10">
        <div className="mx-auto flex w-full max-w-[1024px] flex-col gap-8">

          <div className="rounded-lg border border-[var(--alpha-8)] bg-card">
            <div className="border-b border-[var(--alpha-8)] px-6 py-4">
              <h2 className="text-base font-medium text-foreground">
                {t('auth.emailTemplates', { defaultValue: 'Email Templates' })}
              </h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {t('auth.emailTemplatesDescription', {
                  defaultValue: 'Customize the content and appearance of authentication emails.',
                })}
              </p>
            </div>
            <div className="px-6 py-6">
              <EmailTemplateCard
                templates={templates}
                isLoading={isTemplatesLoading}
                isUpdating={isTemplatesUpdating}
                onSave={updateTemplate}
                senderEmail="noreply@insforge.dev"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
