import { useCallback, useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@insforge/ui';
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

      {enabled && (
        <div className="mt-8 flex flex-col gap-5">
          <FormField
            id="smtp-sender-email"
            label="Sender email"
            description="The email address emails are sent from."
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
              placeholder="Your App Name"
              {...form.register('senderName')}
              className={form.formState.errors.senderName ? 'border-destructive' : ''}
            />
          </FormField>

          <FormField
            id="smtp-host"
            label="Host"
            description="Hostname or IP address of your SMTP server."
            error={form.formState.errors.host?.message}
          >
            <Input
              id="smtp-host"
              type="text"
              placeholder="smtp.example.com"
              {...form.register('host')}
              className={form.formState.errors.host ? 'border-destructive' : ''}
            />
          </FormField>

          <FormField
            id="smtp-port"
            label="Port number"
            description="Common ports: 587 (STARTTLS), 465 (implicit TLS)."
            error={form.formState.errors.port?.message}
          >
            <Controller
              name="port"
              control={form.control}
              render={({ field }) => (
                <Select
                  value={String(field.value)}
                  onValueChange={(v) => field.onChange(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="587">587 (STARTTLS)</SelectItem>
                    <SelectItem value="465">465 (Implicit TLS)</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="2525">2525</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>

          <FormField
            id="smtp-min-interval"
            label="Minimum interval"
            description="Seconds between emails to the same user."
            error={form.formState.errors.minIntervalSeconds?.message}
          >
            <Input
              id="smtp-min-interval"
              type="number"
              min="0"
              className={form.formState.errors.minIntervalSeconds ? 'border-destructive' : ''}
              {...form.register('minIntervalSeconds', { valueAsNumber: true })}
            />
          </FormField>

          <FormField
            id="smtp-username"
            label="Username"
            description="SMTP authentication username."
            error={form.formState.errors.username?.message}
          >
            <Input
              id="smtp-username"
              type="text"
              placeholder="SMTP username"
              {...form.register('username')}
              className={form.formState.errors.username ? 'border-destructive' : ''}
            />
          </FormField>

          <FormField
            id="smtp-password"
            label="Password"
            description="Cannot be viewed once saved."
            error={form.formState.errors.password?.message}
          >
            <Input
              id="smtp-password"
              type="password"
              placeholder={config?.hasPassword ? '••••••••••••' : 'SMTP password'}
              {...form.register('password')}
              className={form.formState.errors.password ? 'border-destructive' : ''}
            />
          </FormField>
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
