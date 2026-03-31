import { useCallback, useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Input, Switch } from '@insforge/ui';
import { z } from 'zod';
import {
  upsertSmtpConfigRequestSchema,
  type SmtpConfigSchema,
  type UpsertSmtpConfigRequest,
} from '@insforge/shared-schemas';

type SmtpFormValues = z.input<typeof upsertSmtpConfigRequestSchema>;

interface SmtpSettingsCardProps {
  config: SmtpConfigSchema | undefined;
  isLoading: boolean;
  isUpdating: boolean;
  onSave: (data: UpsertSmtpConfigRequest) => void;
}

const defaultValues: SmtpFormValues = {
  enabled: false,
  host: '',
  port: 587,
  username: '',
  password: undefined,
  senderEmail: '',
  senderName: '',
  minIntervalSeconds: 60,
};

const toFormValues = (config?: SmtpConfigSchema): SmtpFormValues => {
  if (!config) {
    return defaultValues;
  }

  return {
    enabled: config.enabled,
    host: config.host,
    port: config.port as 25 | 465 | 587 | 2525,
    username: config.username,
    password: undefined,
    senderEmail: config.senderEmail,
    senderName: config.senderName,
    minIntervalSeconds: config.minIntervalSeconds,
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
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-foreground">
        {label}
      </label>
      {children}
      {description && !error && (
        <p className="text-[13px] leading-[18px] text-muted-foreground">{description}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function SmtpSettingsCard({ config, isLoading, isUpdating, onSave }: SmtpSettingsCardProps) {
  const form = useForm<SmtpFormValues>({
    resolver: zodResolver(upsertSmtpConfigRequestSchema),
    defaultValues,
  });

  const enabled = form.watch('enabled');

  const resetForm = useCallback(() => {
    form.reset(toFormValues(config));
  }, [config, form]);

  useEffect(() => {
    resetForm();
  }, [resetForm]);

  const handleSubmit = () => {
    void form.handleSubmit((data) => {
      // Normalize empty password to undefined so it doesn't overwrite the stored password
      const normalized = {
        ...data,
        password: data.password || undefined,
      };
      onSave(normalized as UpsertSmtpConfigRequest);
    })();
  };

  const saveDisabled = !form.formState.isDirty || isUpdating;

  if (isLoading) {
    return (
      <div className="flex min-h-[120px] items-center justify-center text-sm text-muted-foreground">
        Loading SMTP configuration...
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Enable Custom SMTP</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Send emails using your own SMTP server instead of the default provider.
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

      {/* Form sections - only visible when enabled */}
      {enabled && (
        <div className="mt-8 flex flex-col gap-10">
          {/* Sender Details Section */}
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-4">
              <p className="text-sm font-medium text-foreground">Sender details</p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Configure the sender information for your emails.
              </p>
            </div>
            <div className="col-span-8 flex flex-col gap-4">
              <FormField
                id="smtp-sender-email"
                label="Sender email address"
                description="The email address the emails are sent from."
                error={form.formState.errors.senderEmail?.message}
              >
                <Input
                  id="smtp-sender-email"
                  type="email"
                  placeholder="noreply@yourdomain.com"
                  {...form.register('senderEmail')}
                  className={form.formState.errors.senderEmail ? 'border-destructive' : ''}
                />
              </FormField>

              <FormField
                id="smtp-sender-name"
                label="Sender name"
                description="Name displayed in the recipient's inbox."
                error={form.formState.errors.senderName?.message}
              >
                <Input
                  id="smtp-sender-name"
                  type="text"
                  placeholder="Your Name"
                  {...form.register('senderName')}
                  className={form.formState.errors.senderName ? 'border-destructive' : ''}
                />
              </FormField>
            </div>
          </div>

          {/* SMTP Provider Settings Section */}
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-4">
              <p className="text-sm font-medium text-foreground">SMTP provider settings</p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Your SMTP credentials will always be encrypted in our database.
              </p>
            </div>
            <div className="col-span-8 flex flex-col gap-4">
              <FormField
                id="smtp-host"
                label="Host"
                description="Hostname or IP address of your SMTP server."
                error={form.formState.errors.host?.message}
              >
                <Input
                  id="smtp-host"
                  type="text"
                  placeholder="your.smtp.host.com"
                  {...form.register('host')}
                  className={form.formState.errors.host ? 'border-destructive' : ''}
                />
              </FormField>

              <FormField
                id="smtp-port"
                label="Port number"
                description="Allowed ports: 25, 465 (implicit TLS), 587 (STARTTLS), 2525."
                error={form.formState.errors.port?.message}
              >
                <select
                  id="smtp-port"
                  {...form.register('port', { valueAsNumber: true })}
                  className={`flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus:border-primary focus:outline-none ${
                    form.formState.errors.port ? 'border-destructive' : 'border-input'
                  }`}
                >
                  <option value={587}>587 (STARTTLS)</option>
                  <option value={465}>465 (Implicit TLS)</option>
                  <option value={25}>25</option>
                  <option value={2525}>2525</option>
                </select>
              </FormField>

              <FormField
                id="smtp-min-interval"
                label="Minimum interval per user"
                description="Minimum time in seconds between emails to the same user."
                error={form.formState.errors.minIntervalSeconds?.message}
              >
                <div className="flex items-center gap-2">
                  <Input
                    id="smtp-min-interval"
                    type="number"
                    min="0"
                    className={`flex-1 ${form.formState.errors.minIntervalSeconds ? 'border-destructive' : ''}`}
                    {...form.register('minIntervalSeconds', { valueAsNumber: true })}
                  />
                  <span className="shrink-0 text-sm text-muted-foreground">seconds</span>
                </div>
              </FormField>

              <FormField
                id="smtp-username"
                label="Username"
                description="Username for your SMTP server."
                error={form.formState.errors.username?.message}
              >
                <Input
                  id="smtp-username"
                  type="text"
                  placeholder="SMTP Username"
                  {...form.register('username')}
                  className={form.formState.errors.username ? 'border-destructive' : ''}
                />
              </FormField>

              <FormField
                id="smtp-password"
                label="Password"
                description="Password for your SMTP server. For security reasons, this password cannot be viewed once saved."
                error={form.formState.errors.password?.message}
              >
                <Input
                  id="smtp-password"
                  type="password"
                  placeholder={config?.hasPassword ? '••••••••••••' : 'Enter SMTP password'}
                  {...form.register('password')}
                  className={form.formState.errors.password ? 'border-destructive' : ''}
                />
              </FormField>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
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
