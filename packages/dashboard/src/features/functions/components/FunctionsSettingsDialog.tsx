import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@insforge/ui';
import { useSchedulesConfig } from '#features/functions/hooks/useSchedulesConfig';

interface FunctionsSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type RetentionOption = string;

interface SettingRowProps {
  label: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}

function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="flex w-full items-start gap-6">
      <div className="w-[260px] shrink-0">
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

function toRetentionOption(retentionDays: number | null): RetentionOption {
  return retentionDays === null ? 'never' : String(retentionDays);
}

export function FunctionsSettingsDialog({ open, onOpenChange }: FunctionsSettingsDialogProps) {
  const { t } = useTranslation('chrome');
  const [retentionDays, setRetentionDays] = useState<RetentionOption | null>(null);
  const [initialRetentionDays, setInitialRetentionDays] = useState<RetentionOption | null>(null);
  const { config, isLoading, isUpdating, error, updateConfig } = useSchedulesConfig();

  useEffect(() => {
    if (!open) {
      setRetentionDays(null);
      setInitialRetentionDays(null);
      return;
    }

    if (!config) {
      return;
    }

    const nextRetentionDays = toRetentionOption(config.retentionDays);

    if (initialRetentionDays === null || retentionDays === initialRetentionDays) {
      setRetentionDays(nextRetentionDays);
      setInitialRetentionDays(nextRetentionDays);
    }
  }, [config, initialRetentionDays, open, retentionDays]);

  const isLoaded = retentionDays !== null && initialRetentionDays !== null;
  const hasChanges = isLoaded && retentionDays !== initialRetentionDays;
  const canClose = !isUpdating;
  const isSelectDisabled = !isLoaded || isLoading || isUpdating;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!canClose) {
      return;
    }
    onOpenChange(nextOpen);
  };

  const handleSave = async () => {
    if (!isLoaded || !hasChanges) {
      return;
    }

    try {
      await updateConfig({
        retentionDays: retentionDays === 'never' ? null : Number(retentionDays),
      });
      onOpenChange(false);
    } catch {
      // The mutation hook already handles error toasts; swallow here to avoid an unhandled rejection.
    }
  };

  return (
    <MenuDialog open={open} onOpenChange={handleOpenChange}>
      <MenuDialogContent>
        <MenuDialogSideNav>
          <MenuDialogSideNavHeader>
            <MenuDialogSideNavTitle>
              {t('functions.settingsTitle', { defaultValue: 'Functions Settings' })}
            </MenuDialogSideNavTitle>
          </MenuDialogSideNavHeader>
          <MenuDialogNav>
            <MenuDialogNavList>
              <MenuDialogNavItem icon={<Settings className="h-5 w-5" />} active={true}>
                {t('functions.schedules', { defaultValue: 'Schedules' })}
              </MenuDialogNavItem>
            </MenuDialogNavList>
          </MenuDialogNav>
        </MenuDialogSideNav>

        <MenuDialogMain>
          <MenuDialogHeader>
            <MenuDialogTitle>
              {t('functions.schedules', { defaultValue: 'Schedules' })}
            </MenuDialogTitle>
            <MenuDialogCloseButton className="ml-auto" />
          </MenuDialogHeader>

          {!isLoaded ? (
            <MenuDialogBody>
              <div className="flex min-h-[92px] items-center justify-center text-sm text-muted-foreground">
                {isLoading && !error
                  ? t('functions.loadingConfiguration', {
                      defaultValue: 'Loading configuration...',
                    })
                  : t('functions.unableToLoadConfiguration', {
                      defaultValue: 'Unable to load configuration.',
                    })}
              </div>
            </MenuDialogBody>
          ) : (
            <>
              <MenuDialogBody>
                <SettingRow
                  label={t('functions.logRetention', { defaultValue: 'Log Retention' })}
                  description={t('functions.logRetentionDescription', {
                    defaultValue: 'How long execution logs are kept before cleanup.',
                  })}
                >
                  <div className="flex justify-end">
                    <Select
                      value={retentionDays ?? undefined}
                      onValueChange={setRetentionDays}
                      disabled={isSelectDisabled}
                    >
                      <SelectTrigger id="retention-days" className="h-9 w-[180px] max-w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[7, 14, 30, 90].map((days) => (
                          <SelectItem key={days} value={String(days)}>
                            {t('functions.retentionDays', {
                              count: days,
                              defaultValue: '{{count}} days',
                            })}
                          </SelectItem>
                        ))}
                        <SelectItem value="never">
                          {t('functions.never', { defaultValue: 'Never' })}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </SettingRow>
              </MenuDialogBody>

              <MenuDialogFooter>
                {hasChanges && (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => handleOpenChange(false)}
                    >
                      {t('functions.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={!isLoaded || isUpdating || !hasChanges}
                    >
                      {isUpdating
                        ? t('functions.saving', { defaultValue: 'Saving...' })
                        : t('functions.saveChanges', { defaultValue: 'Save Changes' })}
                    </Button>
                  </>
                )}
              </MenuDialogFooter>
            </>
          )}
        </MenuDialogMain>
      </MenuDialogContent>
    </MenuDialog>
  );
}
