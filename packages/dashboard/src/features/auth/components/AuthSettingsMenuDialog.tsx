import { useCallback, useEffect, useMemo, useState } from 'react';
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
} from '@insforge/ui';
import {
  updateAuthConfigRequestSchema,
  type AuthConfigSchema,
  type UpdateAuthConfigRequest,
} from '@insforge/shared-schemas';
import { useAuthConfig } from '#features/auth/hooks/useAuthConfig';
import { useToast } from '#lib/hooks/useToast';
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
  const isCloudProject = isInsForgeCloudProject();
  const [activeSection, setActiveSection] = useState<AuthSettingsSection>('general');
  const { config, isLoading, isUpdating, updateConfig } = useAuthConfig();
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
        showToast('Please fix the highlighted errors before saving changes.', 'error');
      }
    )();
  };

  const sectionTitle = useMemo(() => {
    if (activeSection === 'email-verification') {
      return 'Email Verification';
    }
    if (activeSection === 'password') {
      return 'Password';
    }
    return 'General';
  }, [activeSection]);

  const saveDisabled = !form.formState.isDirty || !form.formState.isValid || isUpdating;

  return (
    <MenuDialog open={open} onOpenChange={handleOpenChange}>
      <MenuDialogContent>
        <MenuDialogSideNav>
          <MenuDialogSideNavHeader>
            <MenuDialogSideNavTitle>Auth Settings</MenuDialogSideNavTitle>
          </MenuDialogSideNavHeader>
          <MenuDialogNav>
            <MenuDialogNavList>
              <MenuDialogNavItem
                icon={<Settings className="h-5 w-5" />}
                active={activeSection === 'general'}
                onClick={() => setActiveSection('general')}
              >
                General
              </MenuDialogNavItem>
              {isCloudProject && (
                <MenuDialogNavItem
                  icon={<Mail className="h-5 w-5" />}
                  active={activeSection === 'email-verification'}
                  onClick={() => setActiveSection('email-verification')}
                >
                  Email Verification
                </MenuDialogNavItem>
              )}
              <MenuDialogNavItem
                icon={<Lock className="h-5 w-5" />}
                active={activeSection === 'password'}
                onClick={() => setActiveSection('password')}
              >
                Password
              </MenuDialogNavItem>
            </MenuDialogNavList>
          </MenuDialogNav>
        </MenuDialogSideNav>

        <MenuDialogMain>
          <MenuDialogHeader>
            <MenuDialogTitle>{sectionTitle}</MenuDialogTitle>
            <MenuDialogDescription className="sr-only">
              {sectionTitle} settings
            </MenuDialogDescription>
            <MenuDialogCloseButton className="ml-auto" />
          </MenuDialogHeader>

          {isLoading ? (
            <MenuDialogBody>
              <div className="flex h-full min-h-[120px] items-center justify-center text-sm text-muted-foreground">
                Loading configuration...
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
                      label="Allowed Redirect URLs"
                      description="Allowed redirect destinations for auth flows. Leave empty to allow all URLs."
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
                                  {itemError.message || 'Invalid URL'}
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
                          <span className="px-1">Add URL</span>
                        </button>
                      </div>
                    </SettingRow>
                  </>
                )}

                {activeSection === 'email-verification' && (
                  <>
                    {!isCloudProject ? (
                      <p className="text-sm text-muted-foreground">
                        Email verification settings are available for InsForge Cloud projects only.
                      </p>
                    ) : (
                      <>
                        <SettingRow
                          label="Require Email Verification"
                          description="Users must verify their email address before they can sign in"
                        >
                          <Controller
                            name="requireEmailVerification"
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

                        {requireEmailVerification && (
                          <SettingRow
                            label="Email Verification Method"
                            description="Choose between 6-digit verification code or verification link"
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
                                    <span>{field.value === 'code' ? 'Code' : 'Link'}</span>
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="code">Code</SelectItem>
                                    <SelectItem value="link">Link</SelectItem>
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
                      label="Minimum Password Length"
                      description="Must be between 4 and 128 characters"
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
                            'Must be between 4 and 128 characters'}
                        </p>
                      )}
                    </SettingRow>

                    <SettingRow label="Password Strength Requirements">
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
                                At least 1 number
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
                                At least 1 special character
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
                                At least 1 lowercase character
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
                                At least 1 uppercase character
                              </span>
                            </label>
                          )}
                        />
                      </div>
                    </SettingRow>

                    {isCloudProject && (
                      <SettingRow
                        label="Password Reset Method"
                        description="Choose between 6-digit reset code or reset link"
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
                                <span>{field.value === 'code' ? 'Code' : 'Link'}</span>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="code">Code</SelectItem>
                                <SelectItem value="link">Link</SelectItem>
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
                      Cancel
                    </Button>
                    <Button type="button" onClick={handleSubmit} disabled={saveDisabled}>
                      {isUpdating ? 'Saving...' : 'Save Changes'}
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
