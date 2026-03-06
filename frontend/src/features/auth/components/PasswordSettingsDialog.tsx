import { useCallback, useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@insforge/ui';
import {
  updateAuthConfigRequestSchema,
  type AuthConfigSchema,
  type UpdateAuthConfigRequest,
} from '@insforge/shared-schemas';
import { useAuthConfig } from '@/features/auth/hooks/useAuthConfig';
import { isInsForgeCloudProject } from '@/lib/utils/utils';

interface PasswordSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

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
};

const toFormValues = (config?: AuthConfigSchema): UpdateAuthConfigRequest => {
  if (!config) return defaultValues;
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
  };
};

export function PasswordSettingsDialog({ open, onOpenChange }: PasswordSettingsDialogProps) {
  const isCloudProject = isInsForgeCloudProject();
  const { config, isLoading, isUpdating, updateConfig } = useAuthConfig();

  const form = useForm<UpdateAuthConfigRequest>({
    resolver: zodResolver(updateAuthConfigRequestSchema),
    defaultValues,
  });

  const resetForm = useCallback(() => {
    form.reset(toFormValues(config));
  }, [config, form]);

  useEffect(() => {
    if (open) resetForm();
  }, [open, resetForm]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  const onSubmit = (data: UpdateAuthConfigRequest) => {
    updateConfig(data, {
      onSuccess: () => onOpenChange(false),
    });
  };

  const saveDisabled = !form.formState.isDirty || isUpdating;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="font-medium">Password Settings</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            Loading configuration...
          </div>
        ) : (
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col">
            <div className="space-y-6 p-6">
              {/* Minimum length */}
              <div className="flex items-center justify-between gap-10">
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-medium text-foreground">Min password length</p>
                  <p className="text-xs text-muted-foreground">Between 4 and 128</p>
                </div>
                <Input
                  type="number"
                  min="4"
                  max="128"
                  {...form.register('passwordMinLength', { valueAsNumber: true })}
                  className={`w-20 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none${form.formState.errors.passwordMinLength ? ' border-destructive' : ''}`}
                />
              </div>

              {/* Strength requirements */}
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium text-foreground">Strength requirements</p>
                <div className="flex flex-col gap-2.5">
                  <Controller
                    name="requireNumber"
                    control={form.control}
                    render={({ field }) => (
                      <label className="flex cursor-pointer items-center gap-2">
                        <Checkbox
                          checked={field.value ?? false}
                          onCheckedChange={(checked) => field.onChange(checked)}
                        />
                        <span className="text-sm text-foreground">At least 1 number</span>
                      </label>
                    )}
                  />
                  <Controller
                    name="requireSpecialChar"
                    control={form.control}
                    render={({ field }) => (
                      <label className="flex cursor-pointer items-center gap-2">
                        <Checkbox
                          checked={field.value ?? false}
                          onCheckedChange={(checked) => field.onChange(checked)}
                        />
                        <span className="text-sm text-foreground">At least 1 special character</span>
                      </label>
                    )}
                  />
                  <Controller
                    name="requireLowercase"
                    control={form.control}
                    render={({ field }) => (
                      <label className="flex cursor-pointer items-center gap-2">
                        <Checkbox
                          checked={field.value ?? false}
                          onCheckedChange={(checked) => field.onChange(checked)}
                        />
                        <span className="text-sm text-foreground">At least 1 lowercase character</span>
                      </label>
                    )}
                  />
                  <Controller
                    name="requireUppercase"
                    control={form.control}
                    render={({ field }) => (
                      <label className="flex cursor-pointer items-center gap-2">
                        <Checkbox
                          checked={field.value ?? false}
                          onCheckedChange={(checked) => field.onChange(checked)}
                        />
                        <span className="text-sm text-foreground">At least 1 uppercase character</span>
                      </label>
                    )}
                  />
                </div>
              </div>

              {/* Reset method — cloud only */}
              {isCloudProject && (
                <div className="flex items-center justify-between gap-10">
                  <p className="text-sm font-medium text-foreground">Password reset method</p>
                  <Controller
                    name="resetPasswordMethod"
                    control={form.control}
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={(value) => {
                          if (value) field.onChange(value);
                        }}
                      >
                        <SelectTrigger className="w-32">
                          <span>{field.value === 'code' ? 'Code' : 'Link'}</span>
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

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                className="w-30"
                onClick={() => onOpenChange(false)}
                disabled={isUpdating}
              >
                Cancel
              </Button>
              <Button type="submit" className="w-30" disabled={saveDisabled}>
                {isUpdating ? 'Saving...' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
