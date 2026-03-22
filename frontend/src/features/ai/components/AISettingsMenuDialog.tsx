import { useCallback, useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Settings } from 'lucide-react';
import {
  Button,
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
  Switch,
} from '@insforge/ui';
import {
  updateAIAccessConfigRequestSchema,
  type AIAccessConfigSchema,
  type UpdateAIAccessConfigRequest,
} from '@insforge/shared-schemas';
import { useAIAccessConfig } from '@/features/ai/hooks/useAIAccessConfig';

/** Props for the AISettingsMenuDialog component. */
interface AISettingsMenuDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const defaultValues: UpdateAIAccessConfigRequest = {
  allowAnonAiAccess: true,
};

/** Maps an AIAccessConfigSchema to the form's field values, falling back to defaults. */
const toFormValues = (config?: AIAccessConfigSchema): UpdateAIAccessConfigRequest => {
  if (!config) {
    return defaultValues;
  }
  return { allowAnonAiAccess: config.allowAnonAiAccess };
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

/** Admin dialog for viewing and editing the AI access configuration. */
export function AISettingsMenuDialog({ open, onOpenChange }: AISettingsMenuDialogProps) {
  const { config, isLoading, error, isUpdating, updateConfig } = useAIAccessConfig();

  const form = useForm<UpdateAIAccessConfigRequest>({
    resolver: zodResolver(updateAIAccessConfigRequestSchema),
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
            <MenuDialogSideNavTitle>AI Settings</MenuDialogSideNavTitle>
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
                Failed to load AI configuration. Close and reopen to retry.
              </div>
            </MenuDialogBody>
          ) : (
            <form
              onSubmit={(event) => event.preventDefault()}
              className="flex min-h-0 flex-1 flex-col"
            >
              <MenuDialogBody>
                <SettingRow
                  label="Anonymous AI Access"
                  description="Allow requests authenticated with the anon API key to call AI endpoints (chat, image generation, embeddings)."
                >
                  <Controller
                    name="allowAnonAiAccess"
                    control={form.control}
                    render={({ field }) => (
                      <div className="py-1.5">
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </div>
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
