import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/radix/Button';
import { Input } from '@/components/radix/Input';
import { Switch } from '@/components/radix/Switch';
import { Checkbox } from '@/components/Checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/radix/Select';
import {
  updateAuthConfigRequestSchema,
  type UpdateAuthConfigRequest,
} from '@insforge/shared-schemas';
import { useAuthConfig } from '@/features/auth/hooks/useAuthConfig';
import { isInsForgeCloudProject } from '@/lib/utils/utils';

export function ConfigurationTab() {
  const { config, isLoading, isUpdating, updateConfig } = useAuthConfig();

  const form = useForm<UpdateAuthConfigRequest>({
    resolver: zodResolver(updateAuthConfigRequestSchema),
    defaultValues: {
      requireEmailVerification: false,
      passwordMinLength: 6,
      requireNumber: false,
      requireLowercase: false,
      requireUppercase: false,
      requireSpecialChar: false,
      verifyEmailMethod: 'code',
      resetPasswordMethod: 'code',
      signInRedirectTo: null,
    },
  });

  // Load configuration when config changes
  useEffect(() => {
    if (config) {
      form.reset({
        requireEmailVerification: config.requireEmailVerification,
        passwordMinLength: config.passwordMinLength,
        requireNumber: config.requireNumber,
        requireLowercase: config.requireLowercase,
        requireUppercase: config.requireUppercase,
        requireSpecialChar: config.requireSpecialChar,
        verifyEmailMethod: config.verifyEmailMethod,
        resetPasswordMethod: config.resetPasswordMethod,
        signInRedirectTo: config.signInRedirectTo ?? null,
      });
    }
  }, [config, form]);

  const handleSubmitData = (data: UpdateAuthConfigRequest) => {
    updateConfig(data);
  };

  const handleSubmit = () => {
    void form.handleSubmit(handleSubmitData)();
  };

  const handleReset = () => {
    if (config) {
      form.reset({
        requireEmailVerification: config.requireEmailVerification,
        passwordMinLength: config.passwordMinLength,
        requireNumber: config.requireNumber,
        requireLowercase: config.requireLowercase,
        requireUppercase: config.requireUppercase,
        requireSpecialChar: config.requireSpecialChar,
        verifyEmailMethod: config.verifyEmailMethod,
        resetPasswordMethod: config.resetPasswordMethod,
        signInRedirectTo: config.signInRedirectTo ?? null,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="text-sm text-gray-500 dark:text-zinc-400">Loading configuration...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 w-full max-w-[800px] mx-auto">
      <div className="flex flex-col gap-8">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
            Authentication Configuration
          </h2>
        </div>

        <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-8">
          {/* Sign In Redirect URL */}

          {/* <div className="space-y-6">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-900 dark:text-white">
                Redirect URL After Sign In
              </label>
              <span className="text-xs text-zinc-500 dark:text-neutral-400">
                Your app url after successful authentication
              </span>
              <Input
                type="url"
                placeholder="https://yourapp.com/dashboard"
                {...form.register('signInRedirectTo')}
                className={`bg-white dark:bg-neutral-900 dark:placeholder:text-neutral-400 dark:border-neutral-700 dark:text-white ${
                  form.formState.errors.signInRedirectTo ? 'border-red-500 dark:border-red-500' : ''
                }`}
              />
              {form.formState.errors.signInRedirectTo && (
                <span className="text-xs text-red-500">
                  {form.formState.errors.signInRedirectTo.message || 'Please enter a valid URL'}
                </span>
              )}
            </div>
          </div> */}

          {isInsForgeCloudProject() && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-3">
                  Email Verification
                </h3>
                <div className="h-px bg-gray-200 dark:bg-neutral-700" />
              </div>

              {/* Email Verification Toggle */}
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    Require Email Verification
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-neutral-400">
                    Users must verify their email address before they can sign in
                  </span>
                </div>
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
              </div>

              {/* Verify Email Method - Only shown when email verification is enabled */}
              {form.watch('requireEmailVerification') && (
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-gray-900 dark:text-white">
                      Email Verification Method
                    </label>
                    <span className="text-xs text-zinc-500 dark:text-neutral-400">
                      Choose between 6-digit verification code or verification link
                    </span>
                  </div>
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
                        <SelectTrigger className="w-[240px]">
                          <span className="text-black dark:text-white">
                            {field.value === 'code' ? 'Code' : 'Link'}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="code">Code</SelectItem>
                          <SelectItem value="link">Link</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              )}
            </div>
          )}

          {/* Password Requirements Section */}
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-3">
                Password Requirements
              </h3>
              <div className="h-px bg-gray-200 dark:bg-neutral-700" />
            </div>

            {/* Password Length */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-900 dark:text-white">
                Minimum Password Length
              </label>
              <span className="text-xs text-zinc-500 dark:text-neutral-400">
                Must be between 4 and 128 characters
              </span>
              <Input
                type="number"
                min="4"
                max="128"
                {...form.register('passwordMinLength', { valueAsNumber: true })}
                className={`max-w-xs bg-white dark:bg-neutral-900 dark:placeholder:text-neutral-400 dark:border-neutral-700 dark:text-white ${
                  form.formState.errors.passwordMinLength
                    ? 'border-red-500 dark:border-red-500'
                    : ''
                }`}
              />
              {form.formState.errors.passwordMinLength && (
                <span className="text-xs text-red-500">
                  {form.formState.errors.passwordMinLength.message ||
                    'Must be between 4 and 128 characters'}
                </span>
              )}
            </div>

            {/* Password Strength Checkboxes */}
            <div className="flex flex-col gap-3">
              <label className="text-sm font-medium text-gray-900 dark:text-white">
                Password Strength Requirements
              </label>
              <div className="grid grid-cols-2 gap-4">
                <Controller
                  name="requireNumber"
                  control={form.control}
                  render={({ field }) => (
                    <label className="flex items-center gap-3 cursor-pointer">
                      <Checkbox
                        checked={field.value ?? false}
                        onChange={(checked) => field.onChange(checked)}
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        At least 1 number
                      </span>
                    </label>
                  )}
                />

                <Controller
                  name="requireSpecialChar"
                  control={form.control}
                  render={({ field }) => (
                    <label className="flex items-center gap-3 cursor-pointer">
                      <Checkbox
                        checked={field.value ?? false}
                        onChange={(checked) => field.onChange(checked)}
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        At least 1 special character
                      </span>
                    </label>
                  )}
                />

                <Controller
                  name="requireLowercase"
                  control={form.control}
                  render={({ field }) => (
                    <label className="flex items-center gap-3 cursor-pointer">
                      <Checkbox
                        checked={field.value ?? false}
                        onChange={(checked) => field.onChange(checked)}
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        At least 1 lowercase character
                      </span>
                    </label>
                  )}
                />

                <Controller
                  name="requireUppercase"
                  control={form.control}
                  render={({ field }) => (
                    <label className="flex items-center gap-3 cursor-pointer">
                      <Checkbox
                        checked={field.value ?? false}
                        onChange={(checked) => field.onChange(checked)}
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        At least 1 uppercase character
                      </span>
                    </label>
                  )}
                />
              </div>
            </div>

            {/* Reset Password Method */}
            {isInsForgeCloudProject() && (
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-900 dark:text-white">
                    Password Reset Method
                  </label>
                  <span className="text-xs text-zinc-500 dark:text-neutral-400">
                    Choose between 6-digit reset code or reset link
                  </span>
                </div>
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
                      <SelectTrigger className="w-[240px]">
                        <span className="text-black dark:text-white">
                          {field.value === 'code' ? 'Code' : 'Link'}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="code">Code</SelectItem>
                        <SelectItem value="link">Link</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            )}
          </div>

          {/* Action Buttons - Reserve space even when hidden */}
          <div className="flex justify-end gap-3 min-h-10">
            {form.formState.isDirty && (
              <>
                <Button
                  type="button"
                  onClick={handleReset}
                  disabled={isUpdating}
                  className="h-10 px-6 bg-white border border-zinc-200 shadow-[0px_1px_2px_0px_rgba(0,0,0,0.1)] text-zinc-950 hover:bg-zinc-50 dark:bg-neutral-600 dark:border-neutral-600 dark:text-white dark:hover:bg-neutral-700"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isUpdating}
                  className="h-10 px-6 dark:bg-emerald-300 dark:text-black dark:hover:bg-emerald-400"
                >
                  {isUpdating ? 'Saving...' : 'Save Changes'}
                </Button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
