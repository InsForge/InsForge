import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DatabaseBackup } from 'lucide-react';
import type { UpdateDatabaseBackupConfig } from '@insforge/shared-schemas';
import {
  Button,
  cn,
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
  SelectValue,
  Switch,
} from '@insforge/ui';
import { useBackupConfig } from '#features/database/hooks/useBackupConfig';
import { formatUtcTimestamp } from '#features/database/utils';

interface DatabaseSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Quick-pick chips that prefill the cron field. Values are 5-field cron
// expressions evaluated in UTC by the backend.
const FREQUENCY_PRESETS = [
  { value: '0 0 * * *', labelKey: 'frequencyDaily', defaultLabel: 'Daily' },
  { value: '0 */12 * * *', labelKey: 'frequencyEvery12Hours', defaultLabel: 'Every 12h' },
  { value: '0 */6 * * *', labelKey: 'frequencyEvery6Hours', defaultLabel: 'Every 6h' },
  { value: '0 0 * * 0', labelKey: 'frequencyWeekly', defaultLabel: 'Weekly' },
] as const;

const RETENTION_DAY_OPTIONS = [7, 14, 30, 90];

interface BackupDraft {
  enabled: boolean;
  cronSchedule: string;
  // Stringified day count, or 'never' for null retention.
  retention: string;
}

function sameDraft(a: BackupDraft | null, b: BackupDraft | null): boolean {
  return (
    a !== null &&
    b !== null &&
    a.enabled === b.enabled &&
    a.cronSchedule.trim() === b.cronSchedule.trim() &&
    a.retention === b.retention
  );
}

type CronShapeError = 'invalid' | 'oncePerHour' | null;

/**
 * Client-side shape checks mirroring the backend rules: 5 fields, and a
 * single literal minute (which is exactly "at most once per hour"). Field
 * contents beyond the minute are validated server-side on save, matching how
 * the schedules feature handles cron input.
 */
function validateCronShape(expression: string): CronShapeError {
  const trimmed = expression.trim();
  const fields = trimmed.split(/\s+/);
  if (trimmed === '' || fields.length !== 5) {
    return 'invalid';
  }
  if (!/^\d+$/.test(fields[0])) {
    return 'oncePerHour';
  }
  if (Number(fields[0]) > 59) {
    return 'invalid';
  }
  return null;
}

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

export function DatabaseSettingsDialog({ open, onOpenChange }: DatabaseSettingsDialogProps) {
  const { t } = useTranslation('chrome');
  const [draft, setDraft] = useState<BackupDraft | null>(null);
  const [initialDraft, setInitialDraft] = useState<BackupDraft | null>(null);
  // Query only while open, so an always-mounted (animatable) dialog does not
  // fetch config on pages where it is never used.
  const { config, isLoading, isUpdating, error, updateConfig } = useBackupConfig({
    enabled: open,
  });

  useEffect(() => {
    if (!open) {
      setDraft(null);
      setInitialDraft(null);
      return;
    }

    if (!config) {
      return;
    }

    const next: BackupDraft = {
      enabled: config.enabled,
      cronSchedule: config.cronSchedule,
      retention: config.retentionDays === null ? 'never' : String(config.retentionDays),
    };

    // Only reseed while the user has no pending edits, and bail out when the
    // values already match — drafts are objects, so an unconditional set would
    // change state identity every run and loop the effect.
    if (
      (initialDraft === null || sameDraft(draft, initialDraft)) &&
      !sameDraft(next, initialDraft)
    ) {
      setDraft(next);
      setInitialDraft(next);
    }
  }, [config, draft, initialDraft, open]);

  const isLoaded = draft !== null && initialDraft !== null;
  const hasChanges = isLoaded && !sameDraft(draft, initialDraft);
  const canClose = !isUpdating;
  const isControlDisabled = !isLoaded || isLoading || isUpdating;
  // Schedule details only apply while scheduling is on.
  const isScheduleControlDisabled = isControlDisabled || !draft?.enabled;

  const cronError = draft ? validateCronShape(draft.cronSchedule) : null;
  const isCronValid = draft !== null && cronError === null;
  // The cron only matters while scheduling is on — an invalid leftover in the
  // (grayed-out) field must never block saving the disabled state.
  const isSaveBlocked = draft !== null && draft.enabled && !isCronValid;

  // Feedback below the input follows the schedules convention: a concrete
  // next-run time (from the saved config) rather than a humanized sentence.
  // Hidden while the draft has edits, since it describes the saved schedule.
  const nextBackupLabel =
    !hasChanges && config?.enabled && config.nextBackupAt
      ? formatUtcTimestamp(config.nextBackupAt)
      : null;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!canClose) {
      return;
    }
    onOpenChange(nextOpen);
  };

  const handleSave = async () => {
    if (!isLoaded || !hasChanges || isSaveBlocked) {
      return;
    }

    const patch: UpdateDatabaseBackupConfig = {
      enabled: draft.enabled,
      retentionDays: draft.retention === 'never' ? null : Number(draft.retention),
    };
    // Omit an invalid cron when disabling so the saved schedule stays intact.
    if (isCronValid) {
      patch.cronSchedule = draft.cronSchedule.trim();
    }

    try {
      await updateConfig(patch);
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
              {t('database.settingsTitle', { defaultValue: 'Database Settings' })}
            </MenuDialogSideNavTitle>
          </MenuDialogSideNavHeader>
          <MenuDialogNav>
            <MenuDialogNavList>
              <MenuDialogNavItem icon={<DatabaseBackup className="h-5 w-5" />} active={true}>
                {t('database.settingsBackups', { defaultValue: 'Backups' })}
              </MenuDialogNavItem>
            </MenuDialogNavList>
          </MenuDialogNav>
        </MenuDialogSideNav>

        <MenuDialogMain>
          <MenuDialogHeader>
            <MenuDialogTitle>
              {t('database.settingsBackups', { defaultValue: 'Backups' })}
            </MenuDialogTitle>
            <MenuDialogCloseButton className="ml-auto" />
          </MenuDialogHeader>

          {!isLoaded ? (
            <MenuDialogBody>
              <div className="flex min-h-[92px] items-center justify-center text-sm text-muted-foreground">
                {isLoading && !error
                  ? t('database.loadingConfiguration', {
                      defaultValue: 'Loading configuration...',
                    })
                  : t('database.unableToLoadConfiguration', {
                      defaultValue: 'Unable to load configuration.',
                    })}
              </div>
            </MenuDialogBody>
          ) : (
            <>
              {/* Default gap-2 reads fine for single-row dialogs; here the
                  frequency row's chips + input + echo need more separation. */}
              <MenuDialogBody className="gap-5">
                <SettingRow
                  label={t('database.scheduledBackupsToggle', {
                    defaultValue: 'Scheduled Backups',
                  })}
                  description={t('database.scheduledBackupsToggleDescription', {
                    defaultValue: 'Automatically back up the database on a schedule.',
                  })}
                >
                  <div className="flex justify-end py-1.5">
                    <Switch
                      checked={draft.enabled}
                      onCheckedChange={(checked) =>
                        setDraft((current) =>
                          current ? { ...current, enabled: checked } : current
                        )
                      }
                      disabled={isControlDisabled}
                      aria-label={t('database.scheduledBackupsToggle', {
                        defaultValue: 'Scheduled Backups',
                      })}
                    />
                  </div>
                </SettingRow>

                <SettingRow
                  label={t('database.backupFrequency', { defaultValue: 'Frequency' })}
                  description={t('database.backupFrequencyDescription', {
                    defaultValue: 'When scheduled backups run. Times are in UTC.',
                  })}
                >
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {FREQUENCY_PRESETS.map((preset) => (
                        <Button
                          key={preset.value}
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isScheduleControlDisabled}
                          className={cn(
                            'h-7 rounded border-[var(--alpha-12)] bg-transparent px-2.5 text-xs font-medium text-muted-foreground hover:bg-[var(--alpha-4)] hover:text-foreground',
                            draft.cronSchedule.trim() === preset.value &&
                              'border-[var(--alpha-24)] bg-[var(--alpha-4)] text-foreground'
                          )}
                          onClick={() =>
                            setDraft((current) =>
                              current ? { ...current, cronSchedule: preset.value } : current
                            )
                          }
                        >
                          {t(`database.${preset.labelKey}`, { defaultValue: preset.defaultLabel })}
                        </Button>
                      ))}
                    </div>
                    <Input
                      id="backup-cron"
                      value={draft.cronSchedule}
                      onChange={(event) =>
                        setDraft((current) =>
                          current ? { ...current, cronSchedule: event.target.value } : current
                        )
                      }
                      disabled={isScheduleControlDisabled}
                      placeholder="30 2 * * *"
                      className="h-9 w-[280px] max-w-full font-mono"
                      aria-label={t('database.cronExpressionLabel', {
                        defaultValue: 'Cron expression',
                      })}
                    />
                    {draft.enabled && cronError ? (
                      <p className="w-[280px] max-w-full text-right text-xs leading-4 text-destructive">
                        {cronError === 'invalid'
                          ? t('database.invalidCronExpression', {
                              defaultValue: 'Invalid cron expression.',
                            })
                          : t('database.cronOncePerHour', {
                              defaultValue: 'Backups can run at most once per hour.',
                            })}
                      </p>
                    ) : (
                      nextBackupLabel && (
                        <p className="w-[280px] max-w-full text-right text-xs leading-4 text-muted-foreground">
                          {t('database.nextBackupOn', {
                            date: nextBackupLabel,
                            defaultValue: 'Next backup: {{date}}',
                          })}
                        </p>
                      )
                    )}
                  </div>
                </SettingRow>

                <SettingRow
                  label={t('database.backupRetention', { defaultValue: 'Retention' })}
                  description={t('database.backupRetentionDescription', {
                    defaultValue:
                      'How long scheduled backups are kept before deletion. Manual backups are never deleted automatically.',
                  })}
                >
                  <div className="flex justify-end">
                    <Select
                      value={draft.retention}
                      onValueChange={(value) =>
                        setDraft((current) =>
                          current ? { ...current, retention: value } : current
                        )
                      }
                      disabled={isScheduleControlDisabled}
                    >
                      <SelectTrigger
                        id="backup-retention"
                        aria-label={t('database.backupRetention', { defaultValue: 'Retention' })}
                        className="h-9 w-[240px] max-w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RETENTION_DAY_OPTIONS.map((days) => (
                          <SelectItem key={days} value={String(days)}>
                            {t('database.retentionDays', {
                              count: days,
                              defaultValue: '{{count}} days',
                            })}
                          </SelectItem>
                        ))}
                        {!RETENTION_DAY_OPTIONS.includes(Number(draft.retention)) &&
                          draft.retention !== 'never' && (
                            <SelectItem value={draft.retention}>
                              {t('database.retentionDays', {
                                count: Number(draft.retention),
                                defaultValue: '{{count}} days',
                              })}
                            </SelectItem>
                          )}
                        <SelectItem value="never">
                          {t('database.never', { defaultValue: 'Never' })}
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
                      {t('common.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={!isLoaded || isUpdating || !hasChanges || isSaveBlocked}
                    >
                      {isUpdating
                        ? t('database.saving', { defaultValue: 'Saving...' })
                        : t('database.saveChanges', { defaultValue: 'Save Changes' })}
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
