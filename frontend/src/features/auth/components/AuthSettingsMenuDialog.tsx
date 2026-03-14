import { useCallback, useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Lock, Mail, Settings } from 'lucide-react';
import {
  Button,
  Checkbox,
  Input,
  MenuDialog,
  MenuDialogBody,
  MenuDialogCloseButton,
  MenuDialogContent,
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
import { useAuthConfig } from '@/features/auth/hooks/useAuthConfig';
import { isInsForgeCloudProject } from '@/lib/utils/utils';
import { Textarea } from '@/components/radix';

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
  signInRedirectTo: null,
  redirectUrlWhitelist: [],
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
    signInRedirectTo: config.signInRedirectTo ?? null,
    redirectUrlWhitelist: config.redirectUrlWhitelist ?? [],
  };
};

const redirectWhitelistToText = (redirectUrls?: string[]) => (redirectUrls ?? []).join('\n');

const parseRedirectWhitelist = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

const getRedirectWhitelistErrorMessage = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  if ('message' in error && typeof error.message === 'string' && error.message.length > 0) {
    return error.message;
  }

  for (const value of Object.values(error)) {
    const nestedMessage = getRedirectWhitelistErrorMessage(value);
    if (nestedMessage) {
      return nestedMessage;
    }
  }

  return undefined;
};

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

export function AuthSettingsMenuDialog({ open, onOpenChange }: AuthSettingsMenuDialogProps) {
  const isCloudProject = isInsForgeCloudProject();
  const [activeSection, setActiveSection] = useState<AuthSettingsSection>('general');
  const { config, isLoading, isUpdating, updateConfig } = useAuthConfig();

  const form = useForm<UpdateAuthConfigRequest>({
    resolver: zodResolver(updateAuthConfigRequestSchema),
    defaultValues,
  });

  const requireEmailVerification = form.watch('requireEmailVerification');
  const redirectUrlWhitelist = form.watch('redirectUrlWhitelist') ?? [];
  const redirectWhitelistError = getRedirectWhitelistErrorMessage(
    form.formState.errors.redirectUrlWhitelist
  );

  const resetForm = useCallback(() => {
    form.reset(toFormValues(config));
  }, [config, form]);

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
    void form.handleSubmit((data) => {
      updateConfig(data);
    })();
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

  const saveDisabled = !form.formState.isDirty || isUpdating;

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
                    {redirectUrlWhitelist.length === 0 && (
                      <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                        Redirect URL whitelist is empty. InsForge will currently allow any auth
                        redirect target, which is convenient for local development but insecure for
                        production.
                      </div>
                    )}

                    <SettingRow
                      label="Redirect URL After Sign In"
                      description="Optional default redirect used after successful sign-in. If a whitelist is configured, this URL must also appear in it."
                    >
                      <Input
                        type="url"
                        placeholder="https://yourapp.com/dashboard"
                        {...form.register('signInRedirectTo')}
                        className={
                          form.formState.errors.signInRedirectTo ? 'border-destructive' : ''
                        }
                      />
                      {form.formState.errors.signInRedirectTo && (
                        <p className="pt-1 text-xs text-destructive">
                          {form.formState.errors.signInRedirectTo.message ||
                            'Please enter a valid URL'}
                        </p>
                      )}
                    </SettingRow>

                    <SettingRow
                      label="Redirect URL Whitelist"
                      description="Add one trusted redirect URL per line. InsForge matches exact normalized URLs only, not prefixes."
                    >
                      <Controller
                        name="redirectUrlWhitelist"
                        control={form.control}
                        render={({ field }) => (
                          <Textarea
                            value={redirectWhitelistToText(field.value)}
                            onChange={(event) =>
                              field.onChange(parseRedirectWhitelist(event.target.value))
                            }
                            rows={6}
                            placeholder={
                              'https://yourapp.com/dashboard\nhttps://staging.yourapp.com/callback'
                            }
                            className={redirectWhitelistError ? 'border-destructive' : ''}
                          />
                        )}
                      />
                      {redirectWhitelistError && (
                        <p className="pt-1 text-xs text-destructive">{redirectWhitelistError}</p>
                      )}
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
                      <div className="flex flex-col gap-3 pt-1">
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
