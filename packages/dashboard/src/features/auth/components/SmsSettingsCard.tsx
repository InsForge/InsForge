import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Input, Switch } from '@insforge/ui';
import { z } from 'zod';
import {
  upsertSmsConfigRequestSchema,
  type SmsConfigSchema,
  type UpsertSmsConfigRequest,
} from '@insforge/shared-schemas';

type SmsFormValues = z.input<typeof upsertSmsConfigRequestSchema>;

// The form keeps authToken as '' (not undefined) so Cancel can actually reset
// the field — react-hook-form ignores undefined values in reset(). The empty
// string is stripped before the shared schema (which requires a non-empty
// token when present) validates, and again on submit so the backend keeps the
// stored credential.
const baseResolver = zodResolver(upsertSmsConfigRequestSchema);
const smsFormResolver: typeof baseResolver = (values, context, options) =>
  baseResolver({ ...values, authToken: values.authToken || undefined }, context, options);

interface SmsSettingsCardProps {
  config: SmsConfigSchema | undefined;
  isLoading: boolean;
  isUpdating: boolean;
  onSave: (data: UpsertSmsConfigRequest) => void;
}

const DEFAULT_OTP_MESSAGE_TEMPLATE =
  'Your verification code is {{ code }}. It expires in 5 minutes.';

const defaultValues: SmsFormValues = {
  enabled: false,
  provider: 'twilio',
  accountSid: '',
  authToken: '',
  fromNumber: '',
  messagingServiceSid: '',
  minIntervalSeconds: 60,
  otpMessageTemplate: DEFAULT_OTP_MESSAGE_TEMPLATE,
};

const toFormValues = (config?: SmsConfigSchema): SmsFormValues => {
  if (!config) {
    return defaultValues;
  }

  return {
    enabled: config.enabled,
    // The dashboard only configures Twilio; the console provider is a dev-only
    // API-set state and must never ride along on a dashboard save, or the
    // save-time Twilio credential check would be bypassed.
    provider: 'twilio',
    accountSid: config.accountSid,
    authToken: '',
    fromNumber: config.fromNumber,
    messagingServiceSid: config.messagingServiceSid,
    minIntervalSeconds: config.minIntervalSeconds,
    otpMessageTemplate: config.otpMessageTemplate || DEFAULT_OTP_MESSAGE_TEMPLATE,
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

export function SmsSettingsCard({ config, isLoading, isUpdating, onSave }: SmsSettingsCardProps) {
  const { t } = useTranslation('chrome');
  const form = useForm<SmsFormValues>({
    resolver: smsFormResolver,
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
        provider: 'twilio' as const,
        authToken: data.authToken || undefined,
      };
      onSave(normalized as UpsertSmsConfigRequest);
    })();
  };

  const saveDisabled = !form.formState.isDirty || isUpdating;

  if (isLoading) {
    return (
      <div className="flex min-h-[120px] items-center justify-center text-sm text-muted-foreground">
        {t('auth.loadingSmsConfig', { defaultValue: 'Loading SMS configuration...' })}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">
            {t('auth.enableCustomSms', { defaultValue: 'Enable Custom SMS' })}
          </p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {t('auth.enableCustomSmsDescription', {
              defaultValue: 'Send sign-in codes over SMS using your own Twilio account.',
            })}
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
            id="sms-account-sid"
            label={t('auth.accountSid', { defaultValue: 'Account SID' })}
            description={t('auth.accountSidDescription', {
              defaultValue: 'Found on your Twilio console dashboard.',
            })}
            error={form.formState.errors.accountSid?.message}
          >
            <Input
              id="sms-account-sid"
              type="text"
              placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              {...form.register('accountSid')}
              className={form.formState.errors.accountSid ? 'border-destructive' : ''}
            />
          </FormField>

          <FormField
            id="sms-auth-token"
            label={t('auth.authToken', { defaultValue: 'Auth token' })}
            description={t('auth.smsAuthTokenDescription', {
              defaultValue: 'Cannot be viewed once saved.',
            })}
            error={form.formState.errors.authToken?.message}
          >
            <Input
              id="sms-auth-token"
              type="password"
              placeholder={
                config?.hasAuthToken
                  ? '••••••••••••'
                  : t('auth.smsAuthTokenPlaceholder', { defaultValue: 'Twilio auth token' })
              }
              {...form.register('authToken')}
              className={form.formState.errors.authToken ? 'border-destructive' : ''}
            />
          </FormField>

          <FormField
            id="sms-from-number"
            label={t('auth.fromNumber', { defaultValue: 'From number' })}
            description={t('auth.fromNumberDescription', {
              defaultValue: 'The Twilio phone number messages are sent from, in E.164 format.',
            })}
            error={form.formState.errors.fromNumber?.message}
          >
            <Input
              id="sms-from-number"
              type="text"
              placeholder="+15551234567"
              {...form.register('fromNumber')}
              className={form.formState.errors.fromNumber ? 'border-destructive' : ''}
            />
          </FormField>

          <FormField
            id="sms-messaging-service-sid"
            label={t('auth.messagingServiceSid', { defaultValue: 'Messaging service SID' })}
            description={t('auth.messagingServiceSidDescription', {
              defaultValue: 'Optional. Used instead of the from number when set.',
            })}
            error={form.formState.errors.messagingServiceSid?.message}
          >
            <Input
              id="sms-messaging-service-sid"
              type="text"
              placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              {...form.register('messagingServiceSid')}
              className={form.formState.errors.messagingServiceSid ? 'border-destructive' : ''}
            />
          </FormField>

          <FormField
            id="sms-otp-message-template"
            label={t('auth.otpMessageTemplate', { defaultValue: 'OTP message template' })}
            description={t('auth.otpMessageTemplateDescription', {
              defaultValue:
                'The sign-in text message. {{ code }} is replaced with the 6-digit code.',
            })}
            error={form.formState.errors.otpMessageTemplate?.message}
          >
            <Input
              id="sms-otp-message-template"
              type="text"
              placeholder={DEFAULT_OTP_MESSAGE_TEMPLATE}
              {...form.register('otpMessageTemplate')}
              className={form.formState.errors.otpMessageTemplate ? 'border-destructive' : ''}
            />
          </FormField>

          <FormField
            id="sms-min-interval"
            label={t('auth.minimumInterval', { defaultValue: 'Minimum interval' })}
            description={t('auth.smsMinimumIntervalDescription', {
              defaultValue: 'Seconds between messages to the same phone number.',
            })}
            error={form.formState.errors.minIntervalSeconds?.message}
          >
            <Input
              id="sms-min-interval"
              type="number"
              min="0"
              className={form.formState.errors.minIntervalSeconds ? 'border-destructive' : ''}
              {...form.register('minIntervalSeconds', { valueAsNumber: true })}
            />
          </FormField>
        </div>
      )}

      {/* Footer */}
      {form.formState.isDirty && (
        <div className="mt-6 flex items-center justify-end gap-2 border-t border-[var(--alpha-8)] pt-4">
          <Button type="button" variant="secondary" onClick={resetForm} disabled={isUpdating}>
            {t('auth.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={saveDisabled}>
            {isUpdating
              ? t('auth.saving', { defaultValue: 'Saving...' })
              : t('auth.saveChanges', { defaultValue: 'Save Changes' })}
          </Button>
        </div>
      )}
    </div>
  );
}
