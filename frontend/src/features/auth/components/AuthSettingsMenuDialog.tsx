import { useCallback, useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Lock, Mail, Settings, Shield, X, Plus } from 'lucide-react';
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
  urlOrWildcardPattern,
  type AuthConfigSchema,
  type UpdateAuthConfigRequest,
} from '@insforge/shared-schemas';
import { useAuthConfig } from '@/features/auth/hooks/useAuthConfig';
import { isInsForgeCloudProject } from '@/lib/utils/utils';

interface AuthSettingsMenuDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type AuthSettingsSection = 'general' | 'email-verification' | 'password' | 'security';

const defaultValues: UpdateAuthConfigRequest = {
  requireEmailVerification: false,
  passwordMinLength: 6,
  requireNumber: false,
  requireLowercase: false,
  requireUppercase: false,
  requireSpecialChar: false,
  verifyEmailMethod: 'code',
  resetPasswordMethod: 'code',
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
    redirectUrlWhitelist: config.redirectUrlWhitelist ?? [],
  };
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

  // Local state for the new-URL input in the Security section
  const [newUrlInput, setNewUrlInput] = useState('');
  const [newUrlError, setNewUrlError] = useState('');

  const form = useForm<UpdateAuthConfigRequest>({
    resolver: zodResolver(updateAuthConfigRequestSchema),
    defaultValues,
  });

  const requireEmailVerification = form.watch('requireEmailVerification');
  const redirectUrlWhitelist = form.watch('redirectUrlWhitelist') ?? [];

  const resetForm = useCallback(() => {
    form.reset(toFormValues(config));
    setNewUrlInput('');
    setNewUrlError('');
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
    if (activeSection === 'security') {
      return 'Security';
    }
    return 'General';
  }, [activeSection]);

  const saveDisabled = !form.formState.isDirty || isUpdating;

  // ---- Redirect URL Whitelist helpers ----

  const handleAddUrl = () => {
    const trimmed = newUrlInput.trim();
    if (!trimmed) {
      setNewUrlError('Please enter a URL');
      return;
    }

    // Validate against the same regex used by the backend — rejects ftp://, javascript:, etc.
    if (!urlOrWildcardPattern.test(trimmed)) {
      setNewUrlError(
        'Please enter a valid http/https URL (e.g. https://yourapp.com/callback) or wildcard pattern (e.g. https://*.example.com)'
      );
      return;
    }

    if (redirectUrlWhitelist.includes(trimmed)) {
      setNewUrlError('This URL is already in the list');
      return;
    }

    form.setValue('redirectUrlWhitelist', [...redirectUrlWhitelist, trimmed], {
      shouldDirty: true,
    });
    setNewUrlInput('');
    setNewUrlError('');
  };

  const handleRemoveUrl = (urlToRemove: string) => {
    form.setValue(
      'redirectUrlWhitelist',
      redirectUrlWhitelist.filter((u) => u !== urlToRemove),
      { shouldDirty: true }
    );
  };

  const handleNewUrlKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddUrl();
    }
  };

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
              <MenuDialogNavItem
                icon={<Shield className="h-5 w-5" />}
                active={activeSection === 'security'}
                onClick={() => setActiveSection('security')}
              >
                Security
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
                  <SettingRow
                    label="Redirect URL"
                    description="Configure allowed redirect URLs in the Security section. Your app must supply a redirect URL in each auth request, and it will be validated against the whitelist."
                  >
                    <p className="text-sm text-muted-foreground">
                      Redirect URLs are managed via the whitelist in the Security section.
                    </p>
                  </SettingRow>
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

                {activeSection === 'security' && (
                  <>
                    {redirectUrlWhitelist.length === 0 && (
                      <div className="mb-4 rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
                        <strong>Open redirects enabled</strong> — no whitelist is configured. Auth
                        flows will accept any redirect URL. This is convenient for development but
                        is not recommended for production deployments. Add at least one trusted URL
                        to enforce redirect validation.
                      </div>
                    )}

                    <SettingRow
                      label="Redirect URL Whitelist"
                      description="Only these URLs may be used as redirect targets in auth flows (OAuth, email verification). Leave empty to allow any URL (not recommended for production)."
                    >
                      <div className="flex flex-col gap-2">
                        {/* Existing entries */}
                        {redirectUrlWhitelist.length > 0 && (
                          <ul className="flex flex-col gap-1.5">
                            {redirectUrlWhitelist.map((url) => (
                              <li
                                key={url}
                                className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-1.5"
                              >
                                <span className="min-w-0 truncate text-sm text-foreground">
                                  {url}
                                </span>
                                <button
                                  type="button"
                                  aria-label={`Remove ${url}`}
                                  onClick={() => handleRemoveUrl(url)}
                                  className="ml-2 shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}

                        {/* Add new URL */}
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <Input
                              type="text"
                              placeholder="https://yourapp.com/callback"
                              value={newUrlInput}
                              onChange={(e) => {
                                setNewUrlInput(e.target.value);
                                if (newUrlError) {
                                  setNewUrlError('');
                                }
                              }}
                              onKeyDown={handleNewUrlKeyDown}
                              className={newUrlError ? 'border-destructive' : ''}
                            />
                            {newUrlError && (
                              <p className="pt-1 text-xs text-destructive">{newUrlError}</p>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={handleAddUrl}
                            className="shrink-0"
                          >
                            <Plus className="mr-1.5 h-4 w-4" />
                            Add
                          </Button>
                        </div>
                      </div>
                    </SettingRow>
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
