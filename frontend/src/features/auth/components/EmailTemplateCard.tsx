import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Select, SelectContent, SelectItem, SelectTrigger, Input } from '@insforge/ui';
import type { EmailTemplateSchema, UpdateEmailTemplateRequest } from '@insforge/shared-schemas';

interface EmailTemplateCardProps {
  templates: EmailTemplateSchema[];
  isLoading: boolean;
  isUpdating: boolean;
  onSave: (params: { type: string; data: UpdateEmailTemplateRequest }) => void;
}

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="flex w-full items-start gap-6">
      <div className="w-[300px] shrink-0">
        <div className="py-1.5">
          <p className="text-sm leading-5 text-foreground">{label}</p>
        </div>
        {description && (
          <p className="pt-1 pb-2 text-[13px] leading-[18px] text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const TEMPLATE_LABELS: Record<string, string> = {
  'email-verification-code': 'Email Verification (Code)',
  'email-verification-link': 'Email Verification (Link)',
  'reset-password-code': 'Password Reset (Code)',
  'reset-password-link': 'Password Reset (Link)',
};

const TEMPLATE_PLACEHOLDERS: Record<string, string[]> = {
  'email-verification-code': ['{{ code }}', '{{ email }}'],
  'email-verification-link': ['{{ link }}', '{{ email }}'],
  'reset-password-code': ['{{ code }}', '{{ email }}'],
  'reset-password-link': ['{{ link }}', '{{ email }}'],
};

export function EmailTemplateCard({
  templates,
  isLoading,
  isUpdating,
  onSave,
}: EmailTemplateCardProps) {
  const templateTypes = useMemo(() => templates.map((t) => t.templateType), [templates]);

  const [selectedType, setSelectedType] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'source' | 'preview'>('source');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  // Set initial selected type when templates load
  useEffect(() => {
    if (templateTypes.length > 0 && !selectedType) {
      setSelectedType(templateTypes[0]);
    }
  }, [templateTypes, selectedType]);

  // Load template data when selection changes
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
    resetToTemplate();
  }, [resetToTemplate]);

  const handleTypeChange = (type: string) => {
    setSelectedType(type);
    setActiveTab('source');
    setIsDirty(false);
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
    onSave({
      type: selectedType,
      data: { subject, bodyHtml },
    });
  };

  const handleCancel = () => {
    resetToTemplate();
  };

  const placeholders = TEMPLATE_PLACEHOLDERS[selectedType] ?? [];

  if (isLoading) {
    return (
      <div className="flex min-h-[120px] items-center justify-center text-sm text-muted-foreground">
        Loading email templates...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingRow label="Template" description="Select the email template to customize">
        <Select value={selectedType} onValueChange={handleTypeChange}>
          <SelectTrigger>
            <span>{TEMPLATE_LABELS[selectedType] ?? selectedType}</span>
          </SelectTrigger>
          <SelectContent>
            {templateTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {TEMPLATE_LABELS[type] ?? type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow label="Subject" description="The email subject line">
        <Input
          type="text"
          value={subject}
          onChange={(e) => handleSubjectChange(e.target.value)}
          placeholder="Email subject"
        />
      </SettingRow>

      <SettingRow label="Body" description="The email body in HTML format">
        <div className="flex flex-col gap-2">
          <div className="flex gap-1">
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === 'source'
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab('source')}
            >
              Source
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === 'preview'
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab('preview')}
            >
              Preview
            </button>
          </div>

          {activeTab === 'source' ? (
            <textarea
              className="flex min-h-[300px] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus:border-black focus:outline-none! focus:ring-0! focus:ring-offset-0! dark:focus:border-neutral-500"
              value={bodyHtml}
              onChange={(e) => handleBodyChange(e.target.value)}
              placeholder="Enter HTML template..."
            />
          ) : (
            <div className="min-h-[300px] rounded-md border border-input">
              <iframe
                title="Email template preview"
                sandbox=""
                srcDoc={bodyHtml}
                className="h-[300px] w-full rounded-md"
              />
            </div>
          )}

          {placeholders.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Available placeholders:{' '}
              {placeholders.map((p, i) => (
                <span key={p}>
                  <code className="rounded bg-muted px-1 py-0.5">{p}</code>
                  {i < placeholders.length - 1 ? ', ' : ''}
                </span>
              ))}
            </p>
          )}
        </div>
      </SettingRow>

      {isDirty && (
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={handleCancel} disabled={isUpdating}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={isUpdating}>
            {isUpdating ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      )}
    </div>
  );
}
