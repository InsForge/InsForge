import { useCallback, useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Settings } from 'lucide-react';
import {
  Button,
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
} from '@insforge/ui';
import {
  updateStorageConfigRequestSchema,
  type StorageConfigSchema,
  type UpdateStorageConfigRequest,
} from '@insforge/shared-schemas';
import { useStorageConfig } from '@/features/storage/hooks/useStorageConfig';

/** Props for the StorageSettingsMenuDialog component. */
interface StorageSettingsMenuDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const defaultValues: UpdateStorageConfigRequest = {
  maxFileSizeMb: 50,
};

/** Maps a StorageConfigSchema to the form's field values, falling back to defaults. */
const toFormValues = (config?: StorageConfigSchema): UpdateStorageConfigRequest => {
  if (!config) {
    return defaultValues;
  }
  return { maxFileSizeMb: config.maxFileSizeMb };
};

/** Props for a single row in the settings form. */
interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

/** Renders a label + description alongside a form control. */
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

/** Admin dialog for viewing and editing the storage configuration (max upload size). */
export function StorageSettingsMenuDialog({ open, onOpenChange }: StorageSettingsMenuDialogProps) {
  const { config, isLoading, error, isUpdating, updateConfig } = useStorageConfig();

  const form = useForm<UpdateStorageConfigRequest>({
    resolver: zodResolver(updateStorageConfigRequestSchema),
    defaultValues,
  });

  const resetForm = useCallback(() => {
    form.reset(toFormValues(config));
  }, [config, form]);

  useEffect(() => {
    if (open) {
      resetForm();
    }
  }, [open, resetForm]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetForm();
    }
    onOpenChange(nextOpen);
  };

  const handleSubmit = () => {
    void form.handleSubmit((data) => {
      updateConfig(data, {
        onSuccess: () => {
          form.reset(data);
        },
      });
    })();
  };

  const saveDisabled = !form.formState.isDirty || isUpdating;

  return (
    <MenuDialog open={open} onOpenChange={handleOpenChange}>
      <MenuDialogContent>
        <MenuDialogSideNav>
          <MenuDialogSideNavHeader>
            <MenuDialogSideNavTitle>Storage Settings</MenuDialogSideNavTitle>
          </MenuDialogSideNavHeader>
          <MenuDialogNav>
            <MenuDialogNavList>
              <MenuDialogNavItem
                icon={<Settings className="h-5 w-5" />}
                active={true}
                onClick={() => {}}
              >
                General
              </MenuDialogNavItem>
            </MenuDialogNavList>
          </MenuDialogNav>
        </MenuDialogSideNav>

        <MenuDialogMain>
          <MenuDialogHeader>
            <MenuDialogTitle>General</MenuDialogTitle>
            <MenuDialogCloseButton className="ml-auto" />
          </MenuDialogHeader>

          {isLoading ? (
            <MenuDialogBody>
              <div className="flex h-full min-h-[120px] items-center justify-center text-sm text-muted-foreground">
                Loading configuration...
              </div>
            </MenuDialogBody>
          ) : error ? (
            <MenuDialogBody>
              <div className="flex h-full min-h-[120px] items-center justify-center text-sm text-destructive">
                Failed to load storage configuration. Close and reopen to retry.
              </div>
            </MenuDialogBody>
          ) : (
            <form
              onSubmit={(event) => event.preventDefault()}
              className="flex min-h-0 flex-1 flex-col"
            >
              <MenuDialogBody>
                <SettingRow
                  label="Maximum Upload Size"
                  description="Files exceeding this limit will be rejected."
                >
                  <Controller
                    name="maxFileSizeMb"
                    control={form.control}
                    render={({ field }) => (
                      <>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min="1"
                            max="200"
                            {...field}
                            onChange={(e) => {
                              const parsed = parseInt(e.target.value);
                              field.onChange(isNaN(parsed) ? '' : parsed);
                            }}
                            className={
                              form.formState.errors.maxFileSizeMb ? 'border-destructive' : ''
                            }
                          />
                          <span className="shrink-0 text-sm text-muted-foreground">MB</span>
                        </div>
                        {form.formState.errors.maxFileSizeMb && (
                          <p className="pt-1 text-xs text-destructive">
                            {form.formState.errors.maxFileSizeMb.message ||
                              'Must be between 1 and 200 MB'}
                          </p>
                        )}
                      </>
                    )}
                  />
                </SettingRow>
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
