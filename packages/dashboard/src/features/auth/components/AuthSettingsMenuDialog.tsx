import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Lock, Mail, Settings, Plus, X } from 'lucide-react';
import {
  Button,
  Checkbox,
  Input,
  MenuDialog,
  MenuDialogBody,
  MenuDialogCloseButton,
  MenuDialogContent,
  MenuDialogDescription,
  MenuDialogFooter,
  MenuDialogHeader,
  MenuDialogMain,
  MenuDialogNav,
  MenuDialogNavItem,
  MenuDialogNavList,
  MenuDialogSideNav,
  MenuDialogSideNavHeader,
  MenuDialogSideNavTitle,
  MenuDialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Switch,
  useToast,
} from '@insforge/ui';
import {
  updateAuthConfigRequestSchema,
  type AuthConfigSchema,
  type UpdateAuthConfigRequest,
} from '@insforge/shared-schemas';
import { useAuthConfig } from '#features/auth/hooks/useAuthConfig';
import { useSmtpConfig } from '#features/auth/hooks/useSmtpConfig';
import { isInsForgeCloudProject } from '#lib/utils/utils';

interface AuthSettingsMenuDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type AuthSettingsSection = 'general' | 'email-verification' | 'password';

const defaultValues: UpdateAuthConfigRequest = {
  requireEmailVerification: false,
  passwordMinLength: 6,
  requireNumber: false,
  requireLowercase: false,
  requireUppercase: false,
  requireSpecialChar: false,
  verifyEmailMethod: 'code',
  resetPasswordMethod: 'code',
  allowedRedirectUrls: [],
  disableSignup: false,
};

const toFormValues = (config?: AuthConfigSchema): UpdateAuthConfigRequest => {
  if (!config) {
    return defaultValues;
  }

  return {
    requireEmailVerification: config.requireEmailVerification,
    passwordMinLength: config.passwordMinLength,
    requireNumber: config.requireNumber,
    requireLowercase: config.requireLowercase,
    requireUppercase: config.requireUppercase,
    requireSpecialChar: config.requireSpecialChar,
    verifyEmailMethod: config.verifyEmailMethod,
    resetPasswordMethod: config.resetPasswordMethod,
    allowedRedirectUrls: config.allowedRedirectUrls ?? [],
    disableSignup: config.disableSignup,
  };
};

interface SettingRowProps {
  label: string;
  description?: React.ReactNode;
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
          <div className="pt-1 pb-2 text-[13px] leading-[18px] text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function AuthSettingsMenuDialog({ open, onOpenChange }: AuthSettingsMenuDialogProps) {
  const { t } = useTranslation('chrome');
  const isCloudProject = isInsForgeCloudProject();
  const [activeSection, setActiveSection] = useState<AuthSettingsSection>('general');
  const { config, isLoading, isUpdating, updateConfig } = useAuthConfig();
  const { config: smtpConfig } = useSmtpConfig({ enabled: open && !isCloudProject });
  const hasEmailProvider = isCloudProject || smtpConfig?.enabled === true;
  const isEmailVerificationRecoveryRequired =
    !hasEmailProvider && config?.requireEmailVerification === true;
  const canAccessEmailVerification = hasEmailProvider || isEmailVerificationRecoveryRequired;
  const { showToast } = useToast();

  const form = useForm<UpdateAuthConfigRequest>({
    resolver: zodResolver(updateAuthConfigRequestSchema),
    defaultValues,
    mode: 'onChange',
  });

  const requireEmailVerification = form.watch('requireEmailVerification');
  const watchedAllowedRedirectUrls = form.watch('allowedRedirectUrls');
  const allowedRedirectUrls = useMemo(
    () => watchedAllowedRedirectUrls ?? [],
    [watchedAllowedRedirectUrls]
  );
  const visibleAllowedRedirectUrls = useMemo(
    () => (allowedRedirectUrls.length > 0 ? allowedRedirectUrls : ['']),
    [allowedRedirectUrls]
  );

  const resetForm = useCallback(() => {
    form.reset(toFormValues(config));
  }, [config, form]);

  const updateAllowedRedirectUrls = useCallback(
    (nextAllowedRedirectUrls: string[]) => {
      form.setValue('allowedRedirectUrls', nextAllowedRedirectUrls, {
        shouldDirty: true,
        shouldValidate: true,
      });
    },
    [form]
  );

  const handleAllowedRedirectUrlChange = useCallback(
    (index: number, value: string) => {
      if (allowedRedirectUrls.length === 0 && value === '') {
        updateAllowedRedirectUrls([]);
        return;
      }

      const nextAllowedRedirectUrls =
        allowedRedirectUrls.length > 0 ? [...allowedRedirectUrls] : [''];
      nextAllowedRedirectUrls[index] = value;
      updateAllowedRedirectUrls(nextAllowedRedirectUrls);
    },
    [allowedRedirectUrls, updateAllowedRedirectUrls]
  );

  const handleRemoveAllowedRedirectUrl = useCallback(
    (index: number) => {
      const nextAllowedRedirectUrls = [...allowedRedirectUrls];
      nextAllowedRedirectUrls.splice(index, 1);
      updateAllowedRedirectUrls(nextAllowedRedirectUrls);
    },
    [allowedRedirectUrls, updateAllowedRedirectUrls]
  );

  const handleAddAllowedRedirectUrl = useCallback(async () => {
    if (allowedRedirectUrls.length === 0) {
      updateAllowedRedirectUrls(['']);
      return;
    }

    const isValid = await form.trigger('allowedRedirectUrls');
    if (!isValid) {
      return;
    }

    updateAllowedRedirectUrls([...allowedRedirectUrls, '']);
  }, [allowedRedirectUrls, form, updateAllowedRedirectUrls]);

  useEffect(() => {
    if (open) {
      resetForm();
      setActiveSection('general');
    }
  }, [open, resetForm]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetForm();
      setActiveSection('general');
    }
    onOpenChange(nextOpen);
  };

  const handleSubmit = () => {
    void form.handleSubmit(
      (data) => {
        updateConfig(data);
      },
      () => {
        showToast(
          t('auth.fixErrorsBeforeSaving', {
            defaultValue: 'Please fix the highlighted errors before saving changes.',
          }),
          'error'
        );
      }
    )();
  };

  const sectionTitle = useMemo(() => {
    if (activeSection === 'email-verification') {
      return t('auth.emailVerification', { defaultValue: 'Email Verification' });
    }
    if (activeSection === 'password') {
      return t('auth.password', { defaultValue: 'Password' });
    }
    return t('auth.general', { defaultValue: 'General' });
  }, [activeSection, t]);

  const saveDisabled =
    !form.formState.isDirty ||
    !form.formState.isValid ||
    isUpdating ||
    (!hasEmailProvider && requireEmailVerification);

  return (
    <MenuDialog open={open} onOpenChange={handleOpenChange}>
      <MenuDialogContent>
        <MenuDialogSideNav>
          <MenuDialogSideNavHeader>
            <MenuDialogSideNavTitle>
              {t('auth.authSettings', { defaultValue: 'Auth Settings' })}
            </MenuDialogSideNavTitle>
          </MenuDialogSideNavHeader>
          <MenuDialogNav>
            <MenuDialogNavList>
              <MenuDialogNavItem
                icon={<Settings className="h-5 w-5" />}
                active={activeSection === 'general'}
                onClick={() => setActiveSection('general')}
              >
                {t('auth.general', { defaultValue: 'General' })}
              </MenuDialogNavItem>
              {canAccessEmailVerification && (
                <MenuDialogNavItem
                  icon={<Mail className="h-5 w-5" />}
                  active={activeSection === 'email-verification'}
                  onClick={() => setActiveSection('email-verification')}
                >
                  {t('auth.emailVerification', { defaultValue: 'Email Verification' })}
                </MenuDialogNavItem>
              )}
              <MenuDialogNavItem
                icon={<Lock className="h-5 w-5" />}
                active={activeSection === 'password'}
                onClick={() => setActiveSection('password')}
              >
                {t('auth.password', { defaultValue: 'Password' })}
              </MenuDialogNavItem>
            </MenuDialogNavList>
          </MenuDialogNav>
        </MenuDialogSideNav>

        <MenuDialogMain>
          <MenuDialogHeader>
            <MenuDialogTitle>{sectionTitle}</MenuDialogTitle>
            <MenuDialogDescription className="sr-only">
              {t('auth.sectionSettings', {
                section: sectionTitle,
                defaultValue: '{{section}} settings',
              })}
            </MenuDialogDescription>
            <MenuDialogCloseButton className="ml-auto" />
          </MenuDialogHeader>

          {isLoading ? (
            <MenuDialogBody>
              <div className="flex h-full min-h-[120px] items-center justify-center text-sm text-muted-foreground">
                {t('auth.loadingConfiguration', { defaultValue: 'Loading configuration...' })}
              </div>
            </MenuDialogBody>
          ) : (
            <form
              onSubmit={(event) => event.preventDefault()}
              className="flex min-h-0 flex-1 flex-col"
            >
              <MenuDialogBody>
                {activeSection === 'general' && (
                  <>
                    <SettingRow
                      label={t('auth.disableSignupsLabel', {
                        defaultValue: 'Disable New User Signups',
                      })}
                      description={t('auth.disableSignupsDescription', {
                        defaultValue:
                          'When on, public sign-up is rejected and only existing users can sign in. Project admins can still create users via the dashboard or API.',
                      })}
                    >
                      <Controller
                        name="disableSignup"
                        control={form.control}
                        render={({ field }) => (
                          <Switch
                            checked={field.value ?? false}
                            onCheckedChange={(value) => field.onChange(value)}
                          />
                        )}
                      />
                    </SettingRow>

                    <SettingRow
                      label={t('auth.allowedRedirectUrlsLabel', {
                        defaultValue: 'Allowed Redirect URLs',
                      })}
                      description={t('auth.allowedRedirectUrlsDescription', {
                        defaultValue:
                          'Allowed redirect destinations for auth flows. Leave empty to allow all URLs.',
                      })}
                    >
                      <div className="flex flex-col gap-2">
                        {visibleAllowedRedirectUrls.map((url, index) => {
                          const urlErrors = form.formState.errors.allowedRedirectUrls;
                          const itemError = Array.isArray(urlErrors) ? urlErrors[index] : undefined;

                          return (
                            <div key={index} className="flex flex-col gap-1">
                              <div className="flex w-full items-center gap-1.5">
                                <Input
                                  value={url}
                                  onChange={(e) =>
                                    handleAllowedRedirectUrlChange(index, e.target.value)
                                  }
                                  placeholder="https://example.com"
                                  className={itemError ? 'border-destructive' : ''}
                                />
                                {allowedRedirectUrls.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveAllowedRedirectUrl(index)}
                                    className="flex size-8 shrink-0 items-center justify-center rounded border border-[var(--alpha-8)] bg-card text-muted-foreground hover:text-foreground"
                                  >
                                    <X className="size-4" />
                                  </button>
                                )}
                              </div>
                              {itemError && (
                                <p className="pt-1 text-xs text-destructive">
                                  {itemError.message ||
                                    t('auth.invalidUrl', { defaultValue: 'Invalid URL' })}
                                </p>
                              )}
                            </div>
                          );
                        })}
                        <button
                          type="button"
                          className="flex h-8 items-center gap-0.5 self-end rounded border border-[var(--alpha-8)] bg-card px-1.5 text-sm font-medium text-foreground"
                          onClick={() => void handleAddAllowedRedirectUrl()}
                        >
                          <Plus className="size-5" />
                          <span className="px-1">
                            {t('auth.addUrl', { defaultValue: 'Add URL' })}
                          </span>
                        </button>
                      </div>
                    </SettingRow>
                  </>
                )}

                {activeSection === 'email-verification' && (
                  <>
                    {!canAccessEmailVerification ? (
                      <p className="text-sm text-muted-foreground">
                        {t('auth.emailVerificationProviderRequired', {
                          defaultValue:
                            'Email verification settings require InsForge Cloud or enabled custom SMTP.',
                        })}
                      </p>
                    ) : (
                      <>
                        {isEmailVerificationRecoveryRequired && (
                          <p className="text-sm text-destructive">
                            {t('auth.emailVerificationRecoveryRequired', {
                              defaultValue:
                                'No email provider is available. Turn off required email verification before saving, or enable custom SMTP.',
                            })}
                          </p>
                        )}
                        <SettingRow
                          label={t('auth.requireEmailVerificationLabel', {
                            defaultValue: 'Require Email Verification',
                          })}
                          description={t('auth.requireEmailVerificationDescription', {
                            defaultValue:
                              'Users must verify their email address before they can sign in',
                          })}
                        >
                          <Controller
                            name="requireEmailVerification"
                            control={form.control}
                            render={({ field }) => (
                              <Switch
                                checked={field.value}
                                disabled={!hasEmailProvider && field.value === false}
                                onCheckedChange={(value) => {
                                  field.onChange(value);
                                }}
                              />
                            )}
                          />
                        </SettingRow>

                        {requireEmailVerification && (
                          <SettingRow
                            label={t('auth.emailVerificationMethodLabel', {
                              defaultValue: 'Email Verification Method',
                            })}
                            description={t('auth.emailVerificationMethodDescription', {
                              defaultValue:
                                'Choose between 6-digit verification code or verification link',
                            })}
                          >
                            <Controller
                              name="verifyEmailMethod"
                              control={form.control}
                              render={({ field }) => (
                                <Select
                                  value={field.value}
                                  onValueChange={(value) => {
                                    if (value) {
                                      field.onChange(value);
                                    }
                                  }}
                                >
                                  <SelectTrigger>
                                    <span>
                                      {field.value === 'code'
                                        ? t('auth.code', { defaultValue: 'Code' })
                                        : t('auth.link', { defaultValue: 'Link' })}
                                    </span>
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="code">
                                      {t('auth.code', { defaultValue: 'Code' })}
                                    </SelectItem>
                                    <SelectItem value="link">
                                      {t('auth.link', { defaultValue: 'Link' })}
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              )}
                            />
                          </SettingRow>
                        )}
                      </>
                    )}
                  </>
                )}

                {activeSection === 'password' && (
                  <>
                    <SettingRow
                      label={t('auth.minPasswordLengthLabel', {
                        defaultValue: 'Minimum Password Length',
                      })}
                      description={t('auth.minPasswordLengthDescription', {
                        defaultValue: 'Must be between 4 and 128 characters',
                      })}
                    >
                      <Input
                        type="number"
                        min="4"
                        max="128"
                        {...form.register('passwordMinLength', { valueAsNumber: true })}
                        className={
                          form.formState.errors.passwordMinLength ? 'border-destructive' : ''
                        }
                      />
                      {form.formState.errors.passwordMinLength && (
                        <p className="pt-1 text-xs text-destructive">
                          {form.formState.errors.passwordMinLength.message ||
                            t('auth.minPasswordLengthDescription', {
                              defaultValue: 'Must be between 4 and 128 characters',
                            })}
                        </p>
                      )}
                    </SettingRow>

                    <SettingRow
                      label={t('auth.passwordStrengthLabel', {
                        defaultValue: 'Password Strength Requirements',
                      })}
                    >
                      <div className="flex flex-col gap-3 pt-1 pb-8">
                        <Controller
                          name="requireNumber"
                          control={form.control}
                          render={({ field }) => (
                            <label className="flex items-center gap-2">
                              <Checkbox
                                checked={field.value ?? false}
                                onCheckedChange={(checked) => field.onChange(checked)}
                              />
                              <span className="text-sm leading-5 text-foreground">
                                {t('auth.atLeastOneNumber', { defaultValue: 'At least 1 number' })}
                              </span>
                            </label>
                          )}
                        />

                        <Controller
                          name="requireSpecialChar"
                          control={form.control}
                          render={({ field }) => (
                            <label className="flex items-center gap-2">
                              <Checkbox
                                checked={field.value ?? false}
                                onCheckedChange={(checked) => field.onChange(checked)}
                              />
                              <span className="text-sm leading-5 text-foreground">
                                {t('auth.atLeastOneSpecialChar', {
                                  defaultValue: 'At least 1 special character',
                                })}
                              </span>
                            </label>
                          )}
                        />

                        <Controller
                          name="requireLowercase"
                          control={form.control}
                          render={({ field }) => (
                            <label className="flex items-center gap-2">
                              <Checkbox
                                checked={field.value ?? false}
                                onCheckedChange={(checked) => field.onChange(checked)}
                              />
                              <span className="text-sm leading-5 text-foreground">
                                {t('auth.atLeastOneLowercase', {
                                  defaultValue: 'At least 1 lowercase character',
                                })}
                              </span>
                            </label>
                          )}
                        />

                        <Controller
                          name="requireUppercase"
                          control={form.control}
                          render={({ field }) => (
                            <label className="flex items-center gap-2">
                              <Checkbox
                                checked={field.value ?? false}
                                onCheckedChange={(checked) => field.onChange(checked)}
                              />
                              <span className="text-sm leading-5 text-foreground">
                                {t('auth.atLeastOneUppercase', {
                                  defaultValue: 'At least 1 uppercase character',
                                })}
                              </span>
                            </label>
                          )}
                        />
                      </div>
                    </SettingRow>

                    {isCloudProject && (
                      <SettingRow
                        label={t('auth.passwordResetMethodLabel', {
                          defaultValue: 'Password Reset Method',
                        })}
                        description={t('auth.passwordResetMethodDescription', {
                          defaultValue: 'Choose between 6-digit reset code or reset link',
                        })}
                      >
                        <Controller
                          name="resetPasswordMethod"
                          control={form.control}
                          render={({ field }) => (
                            <Select
                              value={field.value}
                              onValueChange={(value) => {
                                if (value) {
                                  field.onChange(value);
                                }
                              }}
                            >
                              <SelectTrigger>
                                <span>
                                  {field.value === 'code'
                                    ? t('auth.code', { defaultValue: 'Code' })
                                    : t('auth.link', { defaultValue: 'Link' })}
                                </span>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="code">
                                  {t('auth.code', { defaultValue: 'Code' })}
                                </SelectItem>
                                <SelectItem value="link">
                                  {t('auth.link', { defaultValue: 'Link' })}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </SettingRow>
                    )}
                  </>
                )}
              </MenuDialogBody>

              <MenuDialogFooter>
                {form.formState.isDirty && (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={resetForm}
                      disabled={isUpdating}
                    >
                      {t('auth.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button type="button" onClick={handleSubmit} disabled={saveDisabled}>
                      {isUpdating
                        ? t('auth.saving', { defaultValue: 'Saving...' })
                        : t('auth.saveChanges', { defaultValue: 'Save Changes' })}
                    </Button>
                  </>
                )}
              </MenuDialogFooter>
            </form>
          )}
        </MenuDialogMain>
      </MenuDialogContent>
    </MenuDialog>
  );
}
