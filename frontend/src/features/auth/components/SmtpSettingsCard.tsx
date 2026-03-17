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
    port: config.port,
    username: config.username,
    password: undefined,
    senderEmail: config.senderEmail,
    senderName: config.senderName,
    minIntervalSeconds: config.minIntervalSeconds,
  };
};

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
      onSave(data as UpsertSmtpConfigRequest);
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
    <div className="flex flex-col gap-6">
      <SettingRow
        label="Enable Custom SMTP"
        description="Use your own SMTP server to send authentication emails"
      >
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
      </SettingRow>

      <div className={enabled ? '' : 'opacity-50 pointer-events-none'}>
        <div className="flex flex-col gap-6">
          <SettingRow
            label="Sender Email"
            description="The email address that will appear as the sender"
          >
            <Input
              type="email"
              placeholder="noreply@yourdomain.com"
              {...form.register('senderEmail')}
              className={form.formState.errors.senderEmail ? 'border-destructive' : ''}
            />
            {form.formState.errors.senderEmail && (
              <p className="pt-1 text-xs text-destructive">
                {form.formState.errors.senderEmail.message || 'Invalid sender email'}
              </p>
            )}
          </SettingRow>

          <SettingRow label="Sender Name" description="The display name for the sender">
            <Input
              type="text"
              placeholder="Your App Name"
              {...form.register('senderName')}
              className={form.formState.errors.senderName ? 'border-destructive' : ''}
            />
            {form.formState.errors.senderName && (
              <p className="pt-1 text-xs text-destructive">
                {form.formState.errors.senderName.message || 'Sender name is required'}
              </p>
            )}
          </SettingRow>

          <SettingRow label="Host" description="SMTP server hostname">
            <Input
              type="text"
              placeholder="smtp.yourdomain.com"
              {...form.register('host')}
              className={form.formState.errors.host ? 'border-destructive' : ''}
            />
            {form.formState.errors.host && (
              <p className="pt-1 text-xs text-destructive">
                {form.formState.errors.host.message || 'SMTP host is required'}
              </p>
            )}
          </SettingRow>

          <SettingRow label="Port" description="SMTP server port (e.g. 587 for TLS, 465 for SSL)">
            <Input
              type="number"
              min="1"
              max="65535"
              {...form.register('port', { valueAsNumber: true })}
              className={form.formState.errors.port ? 'border-destructive' : ''}
            />
            {form.formState.errors.port && (
              <p className="pt-1 text-xs text-destructive">
                {form.formState.errors.port.message || 'Port must be between 1 and 65535'}
              </p>
            )}
          </SettingRow>

          <SettingRow
            label="Minimum Interval (seconds)"
            description="Minimum time between emails to the same address"
          >
            <Input
              type="number"
              min="0"
              {...form.register('minIntervalSeconds', { valueAsNumber: true })}
              className={form.formState.errors.minIntervalSeconds ? 'border-destructive' : ''}
            />
            {form.formState.errors.minIntervalSeconds && (
              <p className="pt-1 text-xs text-destructive">
                {form.formState.errors.minIntervalSeconds.message ||
                  'Must be a non-negative number'}
              </p>
            )}
          </SettingRow>

          <SettingRow label="Username" description="SMTP authentication username">
            <Input
              type="text"
              placeholder="smtp-username"
              {...form.register('username')}
              className={form.formState.errors.username ? 'border-destructive' : ''}
            />
            {form.formState.errors.username && (
              <p className="pt-1 text-xs text-destructive">
                {form.formState.errors.username.message || 'SMTP username is required'}
              </p>
            )}
          </SettingRow>

          <SettingRow label="Password" description="SMTP authentication password">
            <Input
              type="password"
              placeholder={config?.hasPassword ? '••••••••••••' : 'Enter SMTP password'}
              {...form.register('password')}
              className={form.formState.errors.password ? 'border-destructive' : ''}
            />
            {form.formState.errors.password && (
              <p className="pt-1 text-xs text-destructive">
                {form.formState.errors.password.message || 'SMTP password is required'}
              </p>
            )}
            <p className="pt-1 text-xs text-muted-foreground">
              Your SMTP credentials will always be encrypted in our database.
            </p>
          </SettingRow>
        </div>
      </div>

      {form.formState.isDirty && (
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={resetForm} disabled={isUpdating}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={saveDisabled}>
            {isUpdating ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      )}
    </div>
  );
}
