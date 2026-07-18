import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Tabs, Tab } from '@insforge/ui';
import { ChevronRight } from 'lucide-react';
import { DEFAULT_EMAIL_TEMPLATES } from './default-email-templates';
import type { EmailTemplateSchema, UpdateEmailTemplateRequest } from '@insforge/shared-schemas';

interface EmailTemplateCardProps {
  templates: EmailTemplateSchema[];
  isLoading: boolean;
  isUpdating: boolean;
  onSave: (
    params: { type: string; data: UpdateEmailTemplateRequest },
    options?: { onSuccess?: () => void }
  ) => void;
  senderEmail?: string;
}

export function EmailTemplateCard({
  templates,
  isLoading,
  isUpdating,
  onSave,
  senderEmail,
}: EmailTemplateCardProps) {
  const { t } = useTranslation('chrome');
  const templateTypes = useMemo(
    () => templates.map((template) => template.templateType),
    [templates]
  );

  const templateInfo = useMemo<Record<string, { title: string; description: string }>>(
    () => ({
      'email-verification-code': {
        title: t('auth.emailVerificationCodeTitle', {
          defaultValue: 'Email Verification (Code)',
        }),
        description: t('auth.emailVerificationCodeDescription', {
          defaultValue: 'Sent when a user needs to verify their email with a 6-digit code.',
        }),
      },
      'email-verification-link': {
        title: t('auth.emailVerificationLinkTitle', {
          defaultValue: 'Email Verification (Link)',
        }),
        description: t('auth.emailVerificationLinkDescription', {
          defaultValue: 'Sent when a user needs to verify their email via a magic link.',
        }),
      },
      'reset-password-code': {
        title: t('auth.resetPasswordCodeTitle', { defaultValue: 'Password Reset (Code)' }),
        description: t('auth.resetPasswordCodeDescription', {
          defaultValue: 'Sent when a user requests a password reset with a 6-digit code.',
        }),
      },
      'reset-password-link': {
        title: t('auth.resetPasswordLinkTitle', { defaultValue: 'Password Reset (Link)' }),
        description: t('auth.resetPasswordLinkDescription', {
          defaultValue: 'Sent when a user requests a password reset via a magic link.',
        }),
      },
      'email-address-change-code': {
        title: t('auth.emailAddressChangeCodeTitle', {
          defaultValue: 'Email Address Change (Code)',
        }),
        description: t('auth.emailAddressChangeCodeDescription', {
          defaultValue: 'Sent when a user changes their email address with a 6-digit code.',
        }),
      },
      'email-address-change-link': {
        title: t('auth.emailAddressChangeLinkTitle', {
          defaultValue: 'Email Address Change (Link)',
        }),
        description: t('auth.emailAddressChangeLinkDescription', {
          defaultValue: 'Sent when a user changes their email address via a magic link.',
        }),
      },
    }),
    [t]
  );

  const templateVariables = useMemo<Record<string, { name: string; description: string; sample: string }[]>>(() => {
    const emailVariable = {
      name: '%EMAIL%',
      description: t('auth.varUserEmail', { defaultValue: "User's email address" }),
      sample: 'user@example.com',
    };
    const nameVariable = {
      name: '%DISPLAY_NAME%',
      description: t('auth.varUserName', { defaultValue: "User's display name" }),
      sample: 'John Doe',
    };
    const appNameVariable = {
      name: '%APP_NAME%',
      description: t('auth.varAppName', { defaultValue: 'Application Name' }),
      sample: 'Your Awesome App',
    };

    return {
      'email-verification-code': [
        {
          name: '%TOKEN%',
          description: t('auth.varVerificationCode', {
            defaultValue: '6-digit verification code',
          }),
          sample: '847295',
        },
        emailVariable,
        nameVariable,
        appNameVariable,
      ],
      'email-verification-link': [
        {
          name: '%LINK%',
          description: t('auth.varVerificationUrl', { defaultValue: 'Email verification URL' }),
          sample: 'https://yourapp.com/verify?token=abc123',
        },
        emailVariable,
        nameVariable,
        appNameVariable,
      ],
      'reset-password-code': [
        {
          name: '%TOKEN%',
          description: t('auth.varResetCode', { defaultValue: '6-digit reset code' }),
          sample: '382916',
        },
        emailVariable,
        nameVariable,
        appNameVariable,
      ],
      'reset-password-link': [
        {
          name: '%LINK%',
          description: t('auth.varResetUrl', { defaultValue: 'Password reset URL' }),
          sample: 'https://yourapp.com/reset?token=xyz789',
        },
        emailVariable,
        nameVariable,
        appNameVariable,
      ],
      'email-address-change-code': [
        {
          name: '%TOKEN%',
          description: t('auth.varEmailChangeCode', { defaultValue: '6-digit email change code' }),
          sample: '918273',
        },
        emailVariable,
        nameVariable,
        appNameVariable,
      ],
      'email-address-change-link': [
        {
          name: '%LINK%',
          description: t('auth.varEmailChangeUrl', { defaultValue: 'Email address change URL' }),
          sample: 'https://yourapp.com/change-email?token=xyz789',
        },
        emailVariable,
        nameVariable,
        appNameVariable,
      ],
    };
  }, [t]);

  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'source' | 'preview'>('source');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.templateType === selectedType),
    [templates, selectedType]
  );

  const resetToTemplate = useCallback(() => {
    if (selectedTemplate) {
      setSubject(selectedTemplate.subject);
      setBodyHtml(selectedTemplate.bodyHtml);
      setIsDirty(false);
    }
  }, [selectedTemplate]);

  const resetToDefaults = useCallback(() => {
    if (selectedType && DEFAULT_EMAIL_TEMPLATES[selectedType]) {
      const { subject: defaultSubject, bodyHtml: defaultBodyHtml } =
        DEFAULT_EMAIL_TEMPLATES[selectedType];
      setSubject(defaultSubject);
      setBodyHtml(defaultBodyHtml);
      setIsDirty(true);
    }
  }, [selectedType]);

  useEffect(() => {
    if (!isDirty) {
      resetToTemplate();
    }
  }, [resetToTemplate, isDirty]);

  const handleSelectTemplate = (type: string) => {
    setSelectedType(type);
    setActiveTab('source');
  };

  const handleSubjectChange = (value: string) => {
    setSubject(value);
    setIsDirty(value !== selectedTemplate?.subject || bodyHtml !== selectedTemplate?.bodyHtml);
  };

  const handleBodyChange = (value: string) => {
    setBodyHtml(value);
    setIsDirty(subject !== selectedTemplate?.subject || value !== selectedTemplate?.bodyHtml);
  };

  const handleSave = () => {
    if (!selectedType) {
      return;
    }
    onSave(
      { type: selectedType, data: { subject, bodyHtml } },
      { onSuccess: () => setIsDirty(false) }
    );
  };

  const handleCancel = () => {
    resetToTemplate();
  };

  const handleBack = () => {
    if (
      isDirty &&
      !window.confirm(
        t('auth.unsavedChangesDiscard', {
          defaultValue: 'You have unsaved changes. Discard them?',
        })
      )
    ) {
      return;
    }
    setSelectedType(null);
    setIsDirty(false);
  };

  const variables = useMemo(
    () => (selectedType ? (templateVariables[selectedType] ?? []) : []),
    [selectedType, templateVariables]
  );
  const info = selectedType ? templateInfo[selectedType] : null;

  // Render preview HTML exactly as authored with variables intact
  const previewHtml = useMemo(() => {
    return bodyHtml;
  }, [bodyHtml]);

  if (isLoading) {
    return (
      <div className="flex min-h-[120px] items-center justify-center text-sm text-muted-foreground">
        {t('auth.loadingEmailTemplates', { defaultValue: 'Loading email templates...' })}
      </div>
    );
  }

  // Template list view
  if (!selectedType) {
    return (
      <div className="flex flex-col">
        {templateTypes.map((type, index) => {
          const currentInfo = templateInfo[type];
          return (
            <button
              key={type}
              type="button"
              onClick={() => handleSelectTemplate(type)}
              className={`flex items-center gap-3 px-1 py-3 text-left transition-colors hover:bg-[var(--alpha-4)] ${
                index < templateTypes.length - 1 ? 'border-b border-[var(--alpha-8)]' : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{currentInfo?.title ?? type}</p>
                {currentInfo?.description && (
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {currentInfo.description}
                  </p>
                )}
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
      </div>
    );
  }

  // Template editor view
  return (
    <div className="flex flex-col gap-6">
      {/* Back navigation */}
      <button
        type="button"
        onClick={handleBack}
        className="flex items-center gap-1 self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight className="h-3.5 w-3.5 rotate-180" />
        {t('auth.backToTemplates', { defaultValue: 'Back to templates' })}
      </button>

      {info && (
        <div>
          <p className="text-sm font-medium text-foreground">{info.title}</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{info.description}</p>
        </div>
      )}

      {/* Sender */}
      {senderEmail && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm text-foreground">
            {t('auth.sender', { defaultValue: 'Sender' })}
          </label>
          <Input
            type="text"
            value={senderEmail}
            readOnly
            className="bg-[var(--alpha-4)] text-foreground"
          />
          <p className="text-[13px] text-muted-foreground">
            {t('auth.senderHelp', {
              defaultValue: 'Emails will be sent from this address by default.',
            })}
          </p>
        </div>
      )}

      {/* Subject */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email-template-subject" className="text-sm text-foreground">
          {t('auth.subject', { defaultValue: 'Subject' })}
        </label>
        <Input
          id="email-template-subject"
          type="text"
          value={subject}
          onChange={(e) => handleSubjectChange(e.target.value)}
          placeholder={t('auth.emailSubjectPlaceholder', { defaultValue: 'Email subject' })}
        />
        {!subject.trim() && isDirty && (
          <p className="text-xs text-destructive">
            {t('auth.subjectRequired', { defaultValue: 'Subject is required' })}
          </p>
        )}
      </div>

      {/* Body with Source/Preview toggle */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label htmlFor="email-template-body" className="text-sm text-foreground">
            {t('auth.body', { defaultValue: 'Body' })}
          </label>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'source' | 'preview')}>
            <Tab value="source">{t('auth.source', { defaultValue: 'Source' })}</Tab>
            <Tab value="preview">{t('auth.preview', { defaultValue: 'Preview' })}</Tab>
          </Tabs>
        </div>

        {activeTab === 'source' ? (
          <textarea
            id="email-template-body"
            className="min-h-[350px] w-full resize-y rounded bg-[var(--alpha-4)] border border-[var(--alpha-12)] px-3 py-2 font-mono text-xs leading-relaxed text-foreground transition-colors placeholder:text-muted-foreground hover:bg-[var(--alpha-8)] focus:outline-none focus:shadow-[0_0_0_1px_rgb(var(--inverse)),0_0_0_2px_rgb(var(--foreground))]"
            value={bodyHtml}
            onChange={(e) => handleBodyChange(e.target.value)}
            placeholder={t('auth.enterHtmlTemplate', { defaultValue: 'Enter HTML template...' })}
            spellCheck={false}
          />
        ) : (
          <div className="min-h-[350px] overflow-hidden rounded border border-[var(--alpha-12)] bg-white">
            <iframe
              title={t('auth.emailTemplatePreview', { defaultValue: 'Email template preview' })}
              sandbox=""
              srcDoc={previewHtml}
              className="h-[350px] w-full border-0"
            />
          </div>
        )}

        {/* Variable reference */}
        {variables.length > 0 && (
          <p className="text-[13px] text-muted-foreground">
            {t('auth.use', { defaultValue: 'Use' })}{' '}
            {variables.map((v, i) => (
              <span key={v.name}>
                <code className="font-mono text-xs text-foreground">{v.name}</code>{' '}
                {t('auth.varFor', { defaultValue: 'for' })} {v.description.toLowerCase()}
                {i < variables.length - 1 ? ', ' : '.'}
              </span>
            ))}{' '}
            {t('auth.avoidScriptPrefix', { defaultValue: 'Avoid' })}{' '}
            <code className="font-mono text-xs text-foreground">&lt;script&gt;</code>{' '}
            {t('auth.avoidScriptSuffix', {
              defaultValue:
                'tags and inline event handlers — most email clients strip or block them.',
            })}
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-[var(--alpha-8)] pt-6 mt-6">
        <Button type="button" variant="ghost" onClick={resetToDefaults} disabled={isUpdating}>
          {t('auth.resetToDefaults', { defaultValue: 'Reset to defaults' })}
        </Button>
        <div className="flex items-center gap-2">
          {isDirty && (
            <Button type="button" variant="secondary" onClick={handleCancel} disabled={isUpdating}>
              {t('auth.cancel', { defaultValue: 'Cancel' })}
            </Button>
          )}
          <Button
            type="button"
            onClick={handleSave}
            disabled={isUpdating || !isDirty || !subject.trim() || !bodyHtml.trim()}
          >
            {isUpdating
              ? t('auth.saving', { defaultValue: 'Saving...' })
              : t('auth.saveChanges', { defaultValue: 'Save Changes' })}
          </Button>
        </div>
      </div>
    </div>
  );
}
