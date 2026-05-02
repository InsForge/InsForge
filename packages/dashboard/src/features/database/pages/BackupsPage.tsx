import { useState } from 'react';
import { Info, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@insforge/ui';
import { CreateBackupDialog } from '#features/database/components/CreateBackupDialog';
import { ConfirmRestoreDialog } from '#features/database/components/ConfirmRestoreDialog';
import { DatabaseEmptyState } from '#features/database/components/DatabaseEmptyState';
import { DatabaseStudioSidebarPanel } from '#features/database/components/DatabaseSidebar';
import { RenameBackupDialog } from '#features/database/components/RenameBackupDialog';
import {
  useDatabaseBackupInfo,
  useDatabaseBackupInstanceInfo,
} from '#features/database/hooks/useDatabaseBackup';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { useConfirm } from '#lib/hooks/useConfirm';
import { useToast } from '#lib/hooks/useToast';

function formatBackupTimestamp(timestamp: string) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  const day = String(date.getDate()).padStart(2, '0');
  const month = date.toLocaleString('en-US', { month: 'short' });
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${day} ${month}, ${year} ${hours}:${minutes}:${seconds}`;
}

export default function BackupsPage() {
  const navigate = useNavigate();
  const host = useDashboardHost();
  const { showToast } = useToast();
  const { confirm, confirmDialogProps } = useConfirm();
  const { backupInfo, refetch } = useDatabaseBackupInfo();
  const { instanceInfo } = useDatabaseBackupInstanceInfo();
  const [createBackupDialogOpen, setCreateBackupDialogOpen] = useState(false);
  const [renameBackupDialogState, setRenameBackupDialogState] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [restoreBackupDialogState, setRestoreBackupDialogState] = useState<{
    id: string;
    timestampLabel: string;
  } | null>(null);

  const isFreePlan = (instanceInfo?.planName?.toLowerCase() ?? 'free') === 'free';
  const manualBackups = backupInfo?.manualBackups ?? [];
  const scheduledBackups = backupInfo?.scheduledBackups ?? [];

  const handleCreateBackupClick = () => {
    setCreateBackupDialogOpen(true);
  };

  const handleUpgradeClick = () => {
    if (host.onNavigateToSubscription) {
      host.onNavigateToSubscription();
      return;
    }

    showToast('Subscription management is only available in cloud-hosting mode.', 'info');
  };

  const handleOpenRestoreBackupDialog = (backupId: string, timestampLabel: string) => {
    setRestoreBackupDialogState({
      id: backupId,
      timestampLabel,
    });
  };

  const handleRestoreBackupClick = async (backupId: string) => {
    if (!host.onRestoreBackup) {
      showToast('Backup restore is not available in the current dashboard mode.', 'info');
      return;
    }

    await host.onRestoreBackup(backupId);
  };

  const handleRenameBackupClick = (backupId: string, backupLabel: string) => {
    setRenameBackupDialogState({
      id: backupId,
      name: backupLabel,
    });
  };

  const handleCreateBackup = async (backupName: string) => {
    if (!host.onCreateBackup) {
      throw new Error('Backup creation is not available in the current dashboard mode.');
    }

    await host.onCreateBackup(backupName);
    await refetch();
  };

  const handleDeleteBackupClick = async (backupId: string, backupLabel: string) => {
    const shouldDelete = await confirm({
      title: 'Delete Backup',
      description: `Are you sure you want to delete "${backupLabel}"? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Close',
      destructive: true,
    });

    if (!shouldDelete) {
      return;
    }

    if (!host.onDeleteBackup) {
      showToast('Backup deletion is not available in the current dashboard mode.', 'info');
      return;
    }

    try {
      await host.onDeleteBackup(backupId);
      await refetch();
    } catch {
      // The cloud host is responsible for delete failure toasts.
    }
  };

  return (
    <>
      <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
        <DatabaseStudioSidebarPanel
          onBack={() =>
            void navigate('/dashboard/database/tables', { state: { slideFromStudio: true } })
          }
        />
        <div className="min-w-0 flex-1 overflow-auto bg-[rgb(var(--semantic-1))]">
          <div className="mx-auto flex w-full max-w-[1024px] flex-col gap-6 px-4 pb-10 pt-8 sm:px-6 sm:pt-10 lg:px-10">
            <h1 className="text-2xl font-medium leading-8 text-foreground">Backup &amp; Restore</h1>

            <div className="overflow-hidden rounded-lg border border-[var(--alpha-8)] bg-card">
              <div
                className={`flex flex-col gap-4 px-6 py-6 sm:flex-row sm:items-start sm:justify-between ${
                  manualBackups.length === 0 ? 'border-b border-[var(--alpha-8)]' : ''
                }`}
              >
                <div className="min-w-0">
                  <h2 className="text-xl font-medium leading-7 text-foreground">
                    Manual Backups ({manualBackups.length}/{isFreePlan ? 1 : 5})
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {isFreePlan && manualBackups.length === 0
                      ? 'Create a manual backup. Free plan allows 1 manual backup.'
                      : 'You can create up to 5 backups manually and can be restored at any time.'}
                  </p>
                </div>
                {isFreePlan && manualBackups.length >= 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 shrink-0 rounded border-[var(--alpha-12)] bg-transparent px-3 text-sm font-medium text-foreground hover:bg-[var(--alpha-4)]"
                    onClick={handleUpgradeClick}
                  >
                    Upgrade for More Backups
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 shrink-0 rounded border-[var(--alpha-12)] bg-transparent px-3 text-sm font-medium text-foreground hover:bg-[var(--alpha-4)]"
                    onClick={handleCreateBackupClick}
                  >
                    Create a Backup
                  </Button>
                )}
              </div>

              {manualBackups.length === 0 ? (
                <DatabaseEmptyState
                  title="No Backup Found"
                  actionLabel="Create a new backup"
                  onAction={handleCreateBackupClick}
                />
              ) : (
                <div className="flex flex-col">
                  {manualBackups.map((backup) => {
                    const savedOnLabel = formatBackupTimestamp(backup.createdAt);
                    const backupLabel = backup.name?.trim() || `${savedOnLabel} (Manual)`;

                    return (
                      <div
                        key={backup.id}
                        className="flex flex-col gap-3 border-t border-[var(--alpha-8)] px-6 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium leading-6 text-foreground">
                              {backupLabel}
                            </p>
                            <button
                              type="button"
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
                              aria-label={`Rename ${backupLabel}`}
                              onClick={() => handleRenameBackupClick(backup.id, backupLabel)}
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-4 text-muted-foreground">
                            <span>Saved on: {savedOnLabel}</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-7 rounded border-[var(--alpha-8)] px-2 text-sm font-medium text-foreground"
                            onClick={() => {
                              handleOpenRestoreBackupDialog(
                                backup.id,
                                savedOnLabel.replace(', ', ' ')
                              );
                            }}
                          >
                            Restore
                          </Button>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="secondary"
                                size="icon-sm"
                                className="h-7 w-7 rounded border-[var(--alpha-8)] text-muted-foreground hover:text-foreground"
                                aria-label={`More actions for ${backupLabel}`}
                              >
                                <MoreHorizontal className="h-5 w-5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" sideOffset={6} className="w-44 p-1.5">
                              <DropdownMenuItem
                                onClick={() => {
                                  void handleDeleteBackupClick(backup.id, backupLabel);
                                }}
                                className="cursor-pointer gap-2 text-destructive"
                              >
                                <Trash2 className="h-5 w-5" />
                                Delete Backup
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {!isFreePlan && (
              <div className="overflow-hidden rounded-lg border border-[var(--alpha-8)] bg-card">
                <div className="px-6 py-6">
                  <div className="min-w-0">
                    <h2 className="text-xl font-medium leading-7 text-foreground">
                      Scheduled Backups
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      Projects are auto backed up each day around midnight in the project&apos;s
                      region and can be restored at any time.
                    </p>
                  </div>
                </div>

                {scheduledBackups.length === 0 ? (
                  <div className="border-t border-[var(--alpha-8)]">
                    <DatabaseEmptyState
                      title="No Backup Found"
                      description="Check back tomorrow or backup manually"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {scheduledBackups.map((backup) => {
                      return (
                        <div
                          key={backup.id}
                          className="flex flex-col gap-3 border-t border-[var(--alpha-8)] px-6 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium leading-6 text-foreground">
                              {backup.name?.trim() || formatBackupTimestamp(backup.createdAt)}
                            </p>
                            {backup.expiresAt && (
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-4 text-muted-foreground">
                                <span>Expire on: {formatBackupTimestamp(backup.expiresAt)}</span>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center justify-end gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="h-7 rounded border-[var(--alpha-8)] px-2 text-sm font-medium text-foreground"
                              onClick={() => {
                                handleOpenRestoreBackupDialog(
                                  backup.id,
                                  formatBackupTimestamp(backup.createdAt).replace(', ', ' ')
                                );
                              }}
                            >
                              Restore
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {isFreePlan && (
              <div className="rounded-lg border border-[var(--alpha-8)] bg-card px-4 py-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-[var(--alpha-8)] bg-semantic-1 text-muted-foreground">
                      <Info className="h-5 w-5" />
                    </div>

                    <div className="min-w-0">
                      <p className="text-base font-normal leading-7 text-foreground">
                        Free Plan does not have Scheduled Backups
                      </p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        Upgrade to a paid plan to unlock scheduled backups.
                      </p>
                    </div>
                  </div>

                  <Button
                    type="button"
                    className="h-8 shrink-0 rounded bg-primary px-3 text-sm font-medium text-[rgb(var(--inverse))] hover:opacity-90"
                    onClick={handleUpgradeClick}
                  >
                    Upgrade to Pro
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <CreateBackupDialog
        open={createBackupDialogOpen}
        onOpenChange={setCreateBackupDialogOpen}
        onCreate={handleCreateBackup}
      />
      <RenameBackupDialog
        open={renameBackupDialogState !== null}
        initialName={renameBackupDialogState?.name ?? ''}
        onOpenChange={(open) => {
          if (!open) {
            setRenameBackupDialogState(null);
          }
        }}
        onSave={(backupName) => {
          if (!renameBackupDialogState) {
            return Promise.resolve();
          }

          if (!host.onRenameBackup) {
            return Promise.reject(
              new Error('Backup rename is not available in the current dashboard mode.')
            );
          }

          return host.onRenameBackup(renameBackupDialogState.id, backupName).then(async () => {
            await refetch();
          });
        }}
      />
      <ConfirmRestoreDialog
        open={restoreBackupDialogState !== null}
        backupTimestampLabel={restoreBackupDialogState?.timestampLabel ?? ''}
        onOpenChange={(open) => {
          if (!open) {
            setRestoreBackupDialogState(null);
          }
        }}
        onRestore={() => {
          if (!restoreBackupDialogState) {
            return Promise.resolve();
          }

          return handleRestoreBackupClick(restoreBackupDialogState.id);
        }}
      />
      <ConfirmDialog {...confirmDialogProps} />
    </>
  );
}
