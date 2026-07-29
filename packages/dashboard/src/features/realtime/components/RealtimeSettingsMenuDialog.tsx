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
import { useRealtimeConfig } from '#features/realtime/hooks/useRealtimeConfig';

interface RealtimeSettingsMenuDialogProps {
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

export function RealtimeSettingsMenuDialog({
  open,
  onOpenChange,
}: RealtimeSettingsMenuDialogProps) {
  const { t } = useTranslation('chrome');
  const [retentionDays, setRetentionDays] = useState<RetentionOption | null>(null);
  const [initialRetentionDays, setInitialRetentionDays] = useState<RetentionOption | null>(null);
  const { config, isLoading, isUpdating, error, updateConfig } = useRealtimeConfig();

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
    setRetentionDays(nextRetentionDays);
    setInitialRetentionDays(nextRetentionDays);
  }, [config, open]);

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
              {t('realtime.realtimeSettings', { defaultValue: 'Realtime Settings' })}
            </MenuDialogSideNavTitle>
          </MenuDialogSideNavHeader>
          <MenuDialogNav>
            <MenuDialogNavList>
              <MenuDialogNavItem icon={<Settings className="h-5 w-5" />} active={true}>
                {t('realtime.general', { defaultValue: 'General' })}
              </MenuDialogNavItem>
            </MenuDialogNavList>
          </MenuDialogNav>
        </MenuDialogSideNav>

        <MenuDialogMain>
          <MenuDialogHeader>
            <MenuDialogTitle>{t('realtime.general', { defaultValue: 'General' })}</MenuDialogTitle>
            <MenuDialogCloseButton className="ml-auto" />
          </MenuDialogHeader>

          {!isLoaded ? (
            <MenuDialogBody>
              <div className="flex min-h-[92px] items-center justify-center text-sm text-muted-foreground">
                {isLoading && !error
                  ? t('realtime.loadingConfiguration', { defaultValue: 'Loading configuration...' })
                  : t('realtime.unableToLoadConfiguration', {
                      defaultValue: 'Unable to load configuration.',
                    })}
              </div>
            </MenuDialogBody>
          ) : (
            <>
              <MenuDialogBody>
                <SettingRow
                  label={t('realtime.messageRetention', { defaultValue: 'Message Retention' })}
                  description={t('realtime.messageRetentionDescription', {
                    defaultValue: 'How long messages are kept before pruning.',
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
                        <SelectItem value="30">
                          {t('realtime.retentionDays', {
                            count: 30,
                            defaultValue_one: '{{count}} day',
                            defaultValue_other: '{{count}} days',
                          })}
                        </SelectItem>
                        <SelectItem value="90">
                          {t('realtime.retentionDays', {
                            count: 90,
                            defaultValue_one: '{{count}} day',
                            defaultValue_other: '{{count}} days',
                          })}
                        </SelectItem>
                        <SelectItem value="180">
                          {t('realtime.retentionDays', {
                            count: 180,
                            defaultValue_one: '{{count}} day',
                            defaultValue_other: '{{count}} days',
                          })}
                        </SelectItem>
                        <SelectItem value="never">
                          {t('realtime.retentionNever', { defaultValue: 'Never' })}
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
                      {t('realtime.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={!isLoaded || isUpdating || !hasChanges}
                    >
                      {isUpdating
                        ? t('realtime.saving', { defaultValue: 'Saving...' })
                        : t('realtime.saveChanges', { defaultValue: 'Save Changes' })}
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
