import { useCallback, useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Input, Switch } from '@insforge/ui';
import { z } from 'zod';
import { type ResendConfigSchema, type UpsertResendConfigRequest } from '@insforge/shared-schemas';

const resendFormSchema = z.object({
  enabled: z.boolean(),
  apiKey: z.string().optional(),
  senderEmail: z.string(),
  senderName: z.string(),
});

type ResendFormValues = z.infer<typeof resendFormSchema>;

interface ResendSettingsCardProps {
  config: ResendConfigSchema | undefined;
  isLoading: boolean;
  isUpdating: boolean;
  onSave: (data: UpsertResendConfigRequest) => void;
}

const defaultValues: ResendFormValues = {
  enabled: false,
  apiKey: undefined,
  senderEmail: '',
  senderName: '',
};

const toFormValues = (config?: ResendConfigSchema): ResendFormValues => {
  if (!config) {
    return defaultValues;
  }

  return {
    enabled: config.enabled,
    apiKey: undefined,
    senderEmail: config.senderEmail,
    senderName: config.senderName,
  };
};

function FormField({
  id,
  label,
  description,
  error,
  children,
}: {
  id: string;
  label: string;
  description?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-8">
      <div className="flex flex-col justify-center py-1">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {description && (
          <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="flex flex-col justify-center">
        {children}
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}

export function ResendSettingsCard({
  config,
  isLoading,
  isUpdating,
  onSave,
}: ResendSettingsCardProps) {
  const form = useForm<ResendFormValues>({
    resolver: zodResolver(resendFormSchema),
    defaultValues,
  });

  const enabled = form.watch('enabled');

  const resetForm = useCallback(() => {
    form.reset(toFormValues(config));
  }, [config, form]);

  useEffect(() => {
    if (!form.formState.isDirty) {
      resetForm();
    }
  }, [form.formState.isDirty, resetForm]);

  const handleSubmit = () => {
    void form.handleSubmit((data) => {
      const normalized = {
        ...data,
        apiKey: data.apiKey || undefined,
      };
      onSave(normalized as UpsertResendConfigRequest);
    })();
  };

  const saveDisabled = !form.formState.isDirty || isUpdating;

  if (isLoading) {
    return (
      <div className="flex min-h-[120px] items-center justify-center text-sm text-muted-foreground">
        Loading Resend configuration...
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Enable Resend</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Send emails using Resend&apos;s API instead of the default provider. Just an API key
            &mdash; no SMTP configuration needed.
          </p>
        </div>
        <Controller
          name="enabled"
          control={form.control}
          render={({ field }) => (
            <Switch
              checked={field.value}
              onCheckedChange={(value) => {
                field.onChange(value);
              }}
            />
          )}
        />
      </div>

      {enabled && (
        <div className="mt-8 flex flex-col gap-5">
          <FormField
            id="resend-sender-email"
            label="Sender email"
            description="The email address emails are sent from."
            error={form.formState.errors.senderEmail?.message}
          >
            <Input
              id="resend-sender-email"
              type="email"
              placeholder="noreply@yourdomain.com"
              {...form.register('senderEmail')}
              className={form.formState.errors.senderEmail ? 'border-destructive' : ''}
            />
          </FormField>

          <FormField
            id="resend-sender-name"
            label="Sender name"
            description="Name displayed in the recipient's inbox."
            error={form.formState.errors.senderName?.message}
          >
            <Input
              id="resend-sender-name"
              type="text"
              placeholder="Your App Name"
              {...form.register('senderName')}
              className={form.formState.errors.senderName ? 'border-destructive' : ''}
            />
          </FormField>

          <FormField
            id="resend-api-key"
            label="API key"
            description="Get your API key from resend.com/api-keys. Cannot be viewed once saved."
            error={form.formState.errors.apiKey?.message}
          >
            <Input
              id="resend-api-key"
              type="password"
              placeholder={config?.hasApiKey ? '••••••••••••' : 're_xxxxxxxxxxxx'}
              {...form.register('apiKey')}
              className={form.formState.errors.apiKey ? 'border-destructive' : ''}
            />
          </FormField>
        </div>
      )}

      {form.formState.isDirty && (
        <div className="mt-6 flex items-center justify-end gap-2 border-t border-[var(--alpha-8)] pt-4">
          <Button type="button" variant="secondary" onClick={resetForm} disabled={isUpdating}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={saveDisabled}>
            {isUpdating ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      )}
    </div>
  );
}
