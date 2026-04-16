import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Tabs, Tab } from '@insforge/ui';
import { ChevronRight } from 'lucide-react';
import type { EmailTemplateSchema, UpdateEmailTemplateRequest } from '@insforge/shared-schemas';

interface EmailTemplateCardProps {
  templates: EmailTemplateSchema[];
  isLoading: boolean;
  isUpdating: boolean;
  onSave: (
    params: { type: string; data: UpdateEmailTemplateRequest },
    options?: { onSuccess?: () => void }
  ) => void;
}

const TEMPLATE_INFO: Record<string, { title: string; description: string }> = {
  'email-verification-code': {
    title: 'Email Verification (Code)',
    description: 'Sent when a user needs to verify their email with a 6-digit code.',
  },
  'email-verification-link': {
    title: 'Email Verification (Link)',
    description: 'Sent when a user needs to verify their email via a magic link.',
  },
  'reset-password-code': {
    title: 'Password Reset (Code)',
    description: 'Sent when a user requests a password reset with a 6-digit code.',
  },
  'reset-password-link': {
    title: 'Password Reset (Link)',
    description: 'Sent when a user requests a password reset via a magic link.',
  },
};

const TEMPLATE_VARIABLES: Record<string, { name: string; description: string; sample: string }[]> =
  {
    'email-verification-code': [
      { name: '{{ token }}', description: '6-digit verification code', sample: '847295' },
      { name: '{{ email }}', description: "User's email address", sample: 'user@example.com' },
      { name: '{{ name }}', description: "User's display name", sample: 'John' },
    ],
    'email-verification-link': [
      {
        name: '{{ link }}',
        description: 'Email verification URL',
        sample: 'https://yourapp.com/verify?token=abc123',
      },
      { name: '{{ email }}', description: "User's email address", sample: 'user@example.com' },
      { name: '{{ name }}', description: "User's display name", sample: 'John' },
    ],
    'reset-password-code': [
      { name: '{{ token }}', description: '6-digit reset code', sample: '382916' },
      { name: '{{ email }}', description: "User's email address", sample: 'user@example.com' },
      { name: '{{ name }}', description: "User's display name", sample: 'John' },
    ],
    'reset-password-link': [
      {
        name: '{{ link }}',
        description: 'Password reset URL',
        sample: 'https://yourapp.com/reset?token=xyz789',
      },
      { name: '{{ email }}', description: "User's email address", sample: 'user@example.com' },
      { name: '{{ name }}', description: "User's display name", sample: 'John' },
    ],
  };

export function EmailTemplateCard({
  templates,
  isLoading,
  isUpdating,
  onSave,
}: EmailTemplateCardProps) {
  const templateTypes = useMemo(() => templates.map((t) => t.templateType), [templates]);

  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'source' | 'preview'>('source');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.templateType === selectedType),
    [templates, selectedType]
  );

  const resetToTemplate = useCallback(() => {
    if (selectedTemplate) {
      setSubject(selectedTemplate.subject);
      setBodyHtml(selectedTemplate.bodyHtml);
      setIsDirty(false);
    }
  }, [selectedTemplate]);

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
    if (isDirty && !window.confirm('You have unsaved changes. Discard them?')) {
      return;
    }
    setSelectedType(null);
    setIsDirty(false);
  };

  const variables = useMemo(
    () => (selectedType ? (TEMPLATE_VARIABLES[selectedType] ?? []) : []),
    [selectedType]
  );
  const info = selectedType ? TEMPLATE_INFO[selectedType] : null;

  // Render preview HTML with sample values replacing placeholders
  const previewHtml = useMemo(() => {
    let html = bodyHtml;
    for (const v of variables) {
      const pattern = new RegExp(
        v.name.replace(/[{}]/g, (ch) => `\\${ch}`).replace(/\s+/g, '\\s*'),
        'g'
      );
      html = html.replace(pattern, v.sample);
    }
    return html;
  }, [bodyHtml, variables]);

  if (isLoading) {
    return (
      <div className="flex min-h-[120px] items-center justify-center text-sm text-muted-foreground">
        Loading email templates...
      </div>
    );
  }

  // Template list view
  if (!selectedType) {
    return (
      <div className="flex flex-col">
        {templateTypes.map((type, index) => {
          const templateInfo = TEMPLATE_INFO[type];
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
                <p className="text-sm font-medium text-foreground">{templateInfo?.title ?? type}</p>
                {templateInfo?.description && (
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {templateInfo.description}
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
        Back to templates
      </button>

      {info && (
        <div>
          <p className="text-sm font-medium text-foreground">{info.title}</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{info.description}</p>
        </div>
      )}

      {/* Subject */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email-template-subject" className="text-sm text-foreground">
          Subject
        </label>
        <Input
          id="email-template-subject"
          type="text"
          value={subject}
          onChange={(e) => handleSubjectChange(e.target.value)}
          placeholder="Email subject"
        />
        {!subject.trim() && isDirty && (
          <p className="text-xs text-destructive">Subject is required</p>
        )}
      </div>

      {/* Body with Source/Preview toggle */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label htmlFor="email-template-body" className="text-sm text-foreground">
            Body
          </label>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'source' | 'preview')}>
            <Tab value="source">Source</Tab>
            <Tab value="preview">Preview</Tab>
          </Tabs>
        </div>

        {activeTab === 'source' ? (
          <textarea
            id="email-template-body"
            className="min-h-[350px] w-full resize-y rounded bg-[var(--alpha-4)] border border-[var(--alpha-12)] px-3 py-2 font-mono text-xs leading-relaxed text-foreground transition-colors placeholder:text-muted-foreground hover:bg-[var(--alpha-8)] focus:outline-none focus:shadow-[0_0_0_1px_rgb(var(--inverse)),0_0_0_2px_rgb(var(--foreground))]"
            value={bodyHtml}
            onChange={(e) => handleBodyChange(e.target.value)}
            placeholder="Enter HTML template..."
            spellCheck={false}
          />
        ) : (
          <div className="min-h-[350px] overflow-hidden rounded border border-[var(--alpha-12)] bg-white">
            <iframe
              title="Email template preview"
              sandbox=""
              srcDoc={previewHtml}
              className="h-[350px] w-full border-0"
            />
          </div>
        )}

        {/* Variable reference */}
        {variables.length > 0 && (
          <p className="text-[13px] text-muted-foreground">
            Use{' '}
            {variables.map((v, i) => (
              <span key={v.name}>
                <code className="font-mono text-xs text-foreground">{v.name}</code> for{' '}
                {v.description.toLowerCase()}
                {i < variables.length - 1 ? ', ' : '.'}
              </span>
            ))}{' '}
            Avoid <code className="font-mono text-xs text-foreground">&lt;script&gt;</code> tags and
            inline event handlers — most email clients strip or block them.
          </p>
        )}
      </div>

      {/* Footer */}
      {isDirty && (
        <div className="flex items-center justify-end gap-2 border-t border-[var(--alpha-8)] pt-4">
          <Button type="button" variant="secondary" onClick={handleCancel} disabled={isUpdating}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isUpdating || !subject.trim() || !bodyHtml.trim()}
          >
            {isUpdating ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      )}
    </div>
  );
}
