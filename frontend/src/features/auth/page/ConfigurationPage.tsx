import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Input,
  Switch,
  Checkbox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components';
import {
  updateAuthConfigRequestSchema,
  type UpdateAuthConfigRequest,
} from '@insforge/shared-schemas';
import { useAuthConfig } from '@/features/auth/hooks/useAuthConfig';
import { isInsForgeCloudProject } from '@/lib/utils/utils';

export default function ConfigurationPage() {
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
      <div className="h-full bg-slate-50 dark:bg-neutral-800 flex flex-col overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-sm text-gray-500 dark:text-zinc-400">Loading configuration...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-slate-50 dark:bg-neutral-800 flex flex-col overflow-hidden">
      <div className="flex-1 flex flex-col overflow-y-auto">
        <div className="p-6 w-full max-w-[1080px] mx-auto">
          <div className="flex flex-col gap-8">
            <div>
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
                Configuration
              </h2>
            </div>

            <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-8">
              {/* Sign In Redirect URL */}
              <div className="space-y-6">
                <div className="bg-white dark:bg-[#333333] rounded-lg p-6 flex items-center gap-10">
                  <div className="w-100 flex flex-col gap-1">
                    <label className="text-sm font-medium text-gray-900 dark:text-white">
                      Redirect URL After Sign In
                    </label>
                    <span className="text-xs text-zinc-500 dark:text-neutral-400">
                      Your app url after successful authentication
                    </span>
                  </div>
                  <div className="w-full max-w-[320px]">
                    <Input
                      type="url"
                      placeholder="https://yourapp.com/dashboard"
                      {...form.register('signInRedirectTo')}
                      className={`bg-white dark:bg-neutral-900 dark:placeholder:text-neutral-400 dark:border-neutral-700 dark:text-white ${
                        form.formState.errors.signInRedirectTo
                          ? 'border-red-500 dark:border-red-500'
                          : ''
                      }`}
                    />
                    {form.formState.errors.signInRedirectTo && (
                      <span className="text-xs text-red-500">
                        {form.formState.errors.signInRedirectTo.message ||
                          'Please enter a valid URL'}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {isInsForgeCloudProject() && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-3">
                      Email Verification
                    </h3>
                  </div>

                  <div className="bg-white dark:bg-[#333333] rounded-lg p-6 space-y-6">
                    {/* Email Verification Toggle */}
                    <div className="flex items-center gap-10">
                      <div className="w-100 flex flex-col gap-1">
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
                          <div className="w-full max-w-[320px]">
                            <Switch
                              checked={field.value}
                              onCheckedChange={(value) => {
                                field.onChange(value);
                              }}
                            />
                          </div>
                        )}
                      />
                    </div>

                    {/* Verify Email Method - Only shown when email verification is enabled */}
                    {form.watch('requireEmailVerification') && (
                      <div className="flex items-center gap-10">
                        <div className="w-100 flex flex-col gap-1">
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
                              <SelectTrigger className="w-full max-w-[320px] dark:bg-neutral-700 dark:border-neutral-700">
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
                </div>
              )}

              {/* Password Requirements Section */}
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-3">
                    Password Requirements
                  </h3>
                </div>

                <div className="bg-white dark:bg-[#333333] rounded-lg p-6 space-y-6">
                  {/* Password Length */}
                  <div className="flex items-center gap-10">
                    <div className="w-100 flex flex-col gap-1">
                      <label className="text-sm font-medium text-gray-900 dark:text-white">
                        Minimum Password Length
                      </label>
                      <span className="text-xs text-zinc-500 dark:text-neutral-400">
                        Must be between 4 and 128 characters
                      </span>
                    </div>
                    <div className="w-full max-w-[320px]">
                      <Input
                        type="number"
                        min="4"
                        max="128"
                        {...form.register('passwordMinLength', { valueAsNumber: true })}
                        className={`bg-white dark:bg-neutral-900 dark:placeholder:text-neutral-400 dark:border-neutral-700 dark:text-white ${
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
                  </div>

                  {/* Password Strength Checkboxes */}
                  <div className="flex items-start gap-10">
                    <div className="w-100 flex flex-col gap-1 justify-center">
                      <label className="text-sm font-medium text-gray-900 dark:text-white">
                        Password Strength Requirements
                      </label>
                    </div>
                    <div className="w-full max-w-[320px] flex flex-col gap-3 justify-center">
                      <Controller
                        name="requireNumber"
                        control={form.control}
                        render={({ field }) => (
                          <label className="flex items-center gap-2 cursor-pointer">
                            <Checkbox
                              checked={field.value ?? false}
                              onChange={(checked) => field.onChange(checked)}
                            />
                            <span className="text-sm text-gray-700 dark:text-white">
                              At least 1 number
                            </span>
                          </label>
                        )}
                      />

                      <Controller
                        name="requireSpecialChar"
                        control={form.control}
                        render={({ field }) => (
                          <label className="flex items-center gap-2 cursor-pointer">
                            <Checkbox
                              checked={field.value ?? false}
                              onChange={(checked) => field.onChange(checked)}
                            />
                            <span className="text-sm text-gray-700 dark:text-white">
                              At least 1 special character
                            </span>
                          </label>
                        )}
                      />

                      <Controller
                        name="requireLowercase"
                        control={form.control}
                        render={({ field }) => (
                          <label className="flex items-center gap-2 cursor-pointer">
                            <Checkbox
                              checked={field.value ?? false}
                              onChange={(checked) => field.onChange(checked)}
                            />
                            <span className="text-sm text-gray-700 dark:text-white">
                              At least 1 lowercase character
                            </span>
                          </label>
                        )}
                      />

                      <Controller
                        name="requireUppercase"
                        control={form.control}
                        render={({ field }) => (
                          <label className="flex items-center gap-2 cursor-pointer">
                            <Checkbox
                              checked={field.value ?? false}
                              onChange={(checked) => field.onChange(checked)}
                            />
                            <span className="text-sm text-gray-700 dark:text-white">
                              At least 1 uppercase character
                            </span>
                          </label>
                        )}
                      />
                    </div>
                  </div>

                  {/* Reset Password Method */}
                  {isInsForgeCloudProject() && (
                    <div className="flex items-center gap-10">
                      <div className="w-100 flex flex-col gap-1">
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
                            <SelectTrigger className="w-full max-w-[320px] dark:bg-neutral-700 dark:border-neutral-700">
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
      </div>
    </div>
  );
}
