import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Cpu, HardDrive, Plug, RefreshCw, Settings } from 'lucide-react';
import {
  Button,
  CopyButton,
  ConfirmDialog,
  Input,
  MenuDialog,
  MenuDialogContent,
  MenuDialogDescription,
  MenuDialogSideNav,
  MenuDialogSideNavHeader,
  MenuDialogSideNavTitle,
  MenuDialogNav,
  MenuDialogNavList,
  MenuDialogNavItem,
  MenuDialogMain,
  MenuDialogHeader,
  MenuDialogTitle,
  MenuDialogBody,
  MenuDialogFooter,
  MenuDialogCloseButton,
} from '@insforge/ui';
import type { InstanceInfoEvent } from '@insforge/shared-schemas';
import { useApiKey } from '#lib/hooks/useMetadata';
import { useDashboardHost, useIsCloudHostingMode } from '#lib/config/DashboardHostContext';
import { useHealth } from '#lib/hooks/useHealth';
import {
  CLOUD_PROJECT_INFO_QUERY_KEY,
  useCloudProjectInfo,
  type CloudProjectInfo,
} from '#lib/hooks/useCloudProjectInfo';
import { useConfirm } from '#lib/hooks/useConfirm';
import { useToast } from '#lib/hooks/useToast';
import { cn, compareVersions, getBackendUrl, isInsForgeCloudProject } from '#lib/utils/utils';
import { MCPSection, CLISection, ConnectionStringSection } from './connect';
import { metadataService } from '#lib/services/metadata.service';

type TabType = 'info' | 'compute' | 'connect';

const INFO_FIELD_CLASS =
  'flex h-8 w-full items-center rounded border border-[var(--alpha-12)] bg-[var(--alpha-4)] px-2.5 text-sm leading-5 text-foreground';

interface ProjectSettingsMenuDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: TabType;
}

export default function ProjectSettingsMenuDialog({
  open,
  onOpenChange,
  defaultTab = 'info',
}: ProjectSettingsMenuDialogProps) {
  const host = useDashboardHost();
  const isCloudHostingMode = useIsCloudHostingMode();
  const onRequestInstanceInfo =
    host.mode === 'cloud-hosting' ? host.onRequestInstanceInfo : undefined;
  const [activeTab, setActiveTab] = useState<TabType>('info');
  const [isVersionOutdated, setIsVersionOutdated] = useState(false);
  const [isUpdatingVersion, setIsUpdatingVersion] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectNameInitialValue, setProjectNameInitialValue] = useState('');
  const [isProjectNameFocused, setIsProjectNameFocused] = useState(false);
  const [instanceInfo, setInstanceInfo] = useState<Omit<InstanceInfoEvent, 'type'> | null>(null);
  const [selectedInstanceType, setSelectedInstanceType] = useState<string | null>(null);
  const [isChangingInstanceType, setIsChangingInstanceType] = useState(false);
  const [isRotatingApiKey, setIsRotatingApiKey] = useState(false);

  const { apiKey, isLoading: isApiKeyLoading } = useApiKey();
  const { version, isLoading: isVersionLoading } = useHealth();
  const { projectInfo, isLoading: isProjectInfoLoading } = useCloudProjectInfo();
  const { confirm, confirmDialogProps } = useConfirm();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const isCloud = isInsForgeCloudProject();
  const canUseCloudHost = isCloud && isCloudHostingMode;
  const projectUrl = useMemo(() => `${getBackendUrl().replace(/\/$/, '')}/`, []);

  const maskedApiKey = apiKey ? `ik_${'*'.repeat(22)}` : 'ik_**********************';
  const latestVersion = projectInfo.latestVersion ?? null;

  const sectionTitle =
    activeTab === 'connect'
      ? 'Connect Project'
      : activeTab === 'compute'
        ? 'Compute & Disk'
        : 'Project Information';
  const isProjectNameDirty = projectName !== projectNameInitialValue;
  const showProjectNameActions =
    isCloud && activeTab === 'info' && (isProjectNameFocused || isProjectNameDirty);
  const showComputeActions =
    activeTab === 'compute' &&
    !!instanceInfo &&
    !!selectedInstanceType &&
    selectedInstanceType !== instanceInfo.currentInstanceType;

  const projectedComputeCost = useMemo(() => {
    if (!instanceInfo || !selectedInstanceType) {
      return null;
    }

    const currentInstance = instanceInfo.instanceTypes.find(
      (type) => type.id === instanceInfo.currentInstanceType
    );
    const nextInstance = instanceInfo.instanceTypes.find(
      (type) => type.id === selectedInstanceType
    );

    if (!currentInstance || !nextInstance) {
      return null;
    }

    const rawProjectedCost =
      instanceInfo.currentOrgComputeCost -
      currentInstance.pricePerMonth +
      nextInstance.pricePerMonth;

    const credits = instanceInfo.computeCredits === -1 ? Infinity : instanceInfo.computeCredits;
    const creditDeduction =
      credits === Infinity ? rawProjectedCost : Math.min(Math.max(rawProjectedCost, 0), credits);
    const afterCredits = Math.max(0, rawProjectedCost - creditDeduction);

    return {
      afterCredits,
    };
  }, [instanceInfo, selectedInstanceType]);

  const requestInstanceInfo = useCallback(async () => {
    if (!onRequestInstanceInfo) {
      return;
    }

    try {
      const nextInstanceInfo = await onRequestInstanceInfo();
      setInstanceInfo(nextInstanceInfo);
      setSelectedInstanceType(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to load compute options', 'error');
    }
  }, [onRequestInstanceInfo, showToast]);

  useEffect(() => {
    if (open) {
      const cloudProjectName = projectInfo.name ?? '';
      const nextTab: TabType =
        defaultTab === 'connect'
          ? 'connect'
          : defaultTab === 'compute' && canUseCloudHost
            ? 'compute'
            : 'info';

      setActiveTab(nextTab);
      setProjectName(cloudProjectName);
      setProjectNameInitialValue(cloudProjectName);
      setIsProjectNameFocused(false);

      if (canUseCloudHost) {
        void requestInstanceInfo();
      }
      return;
    }

    setIsUpdatingVersion(false);
    setIsChangingInstanceType(false);
    setIsProjectNameFocused(false);
    setSelectedInstanceType(null);
    // We intentionally do not depend on projectInfo.name here because the effect should only
    // initialize dialog state on open/close transitions, not reset the dialog during rename syncs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseCloudHost, open, requestInstanceInfo, defaultTab]);

  useEffect(() => {
    if (version && latestVersion) {
      const comparison = compareVersions(version, latestVersion);
      setIsVersionOutdated(comparison < 0);
    }
  }, [version, latestVersion]);

  useEffect(() => {
    if (!open || !canUseCloudHost || isProjectInfoLoading) {
      return;
    }

    if (isProjectNameDirty || isProjectNameFocused) {
      return;
    }

    const cloudProjectName = projectInfo.name ?? '';
    setProjectName(cloudProjectName);
    setProjectNameInitialValue(cloudProjectName);
  }, [
    open,
    canUseCloudHost,
    isProjectInfoLoading,
    isProjectNameDirty,
    isProjectNameFocused,
    projectInfo.name,
  ]);

  const handleDeleteProject = async () => {
    const confirmed = await confirm({
      title: 'Delete Project',
      description: 'Are you certain you wish to remove this project? This action is irreversible.',
      confirmText: 'Delete Project',
      cancelText: 'Cancel',
      destructive: true,
    });

    if (!confirmed) {
      return;
    }

    if (host.mode === 'cloud-hosting' && host.onDeleteProject) {
      try {
        await host.onDeleteProject();
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Failed to delete project', 'error');
      }
      return;
    }
  };

  const handleUpdateVersion = async () => {
    if (host.mode === 'cloud-hosting' && host.onUpdateVersion) {
      setIsUpdatingVersion(true);
      try {
        await host.onUpdateVersion();
      } catch (error) {
        setIsUpdatingVersion(false);
        showToast(
          error instanceof Error ? error.message : 'Failed to update project version',
          'error'
        );
      }
      return;
    }
  };

  const handleCancelProjectNameEdit = () => {
    setProjectName(projectNameInitialValue);
    setIsProjectNameFocused(false);
  };

  const handleSaveProjectName = async () => {
    const nextProjectName = projectName.trim();

    if (!isProjectNameDirty || !nextProjectName) {
      return;
    }

    if (host.mode === 'cloud-hosting' && host.onRenameProject) {
      try {
        await host.onRenameProject(nextProjectName);
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to update project name',
          'error'
        );
        return;
      }
    } else {
      return;
    }

    queryClient.setQueryData<CloudProjectInfo>(CLOUD_PROJECT_INFO_QUERY_KEY, (previous = {}) => ({
      ...previous,
      name: nextProjectName,
    }));

    setProjectName(nextProjectName);
    setProjectNameInitialValue(nextProjectName);
    setIsProjectNameFocused(false);
  };

  const handleRotateApiKey = async () => {
    const confirmed = await confirm({
      title: 'Rotate API Key',
      description:
        'This will generate a new API key. The current key will remain valid for 24 hours to allow for a smooth transition. This action cannot be undone.',
      confirmText: 'Rotate Key',
      cancelText: 'Cancel',
      destructive: true,
    });

    if (!confirmed) {
      return;
    }

    setIsRotatingApiKey(true);
    try {
      const result = await metadataService.rotateApiKey(24);
      queryClient.setQueryData(['metadata', 'apiKey'], result.apiKey);
      showToast(
        'API key rotated successfully. The old key will remain valid for 24 hours.',
        'success'
      );
    } catch {
      showToast('Failed to rotate API key. Please try again.', 'error');
    } finally {
      setIsRotatingApiKey(false);
    }
  };

  const handleChangeInstanceType = async () => {
    if (
      !instanceInfo ||
      !selectedInstanceType ||
      selectedInstanceType === instanceInfo.currentInstanceType
    ) {
      return;
    }

    setIsChangingInstanceType(true);
    showToast(
      'Project is updating compute size, please wait a few seconds and refresh the page.',
      'success'
    );

    if (host.mode === 'cloud-hosting' && host.onRequestInstanceTypeChange) {
      try {
        const result = await host.onRequestInstanceTypeChange(selectedInstanceType);
        setIsChangingInstanceType(false);

        if (result.success) {
          const nextInstanceType = result.instanceType ?? selectedInstanceType;
          if (result.instanceType) {
            setInstanceInfo((prev) =>
              prev
                ? {
                    ...prev,
                    currentInstanceType: nextInstanceType,
                  }
                : prev
            );
          }
          setSelectedInstanceType(null);
          void requestInstanceInfo();
          return;
        }

        showToast(result.error || 'Failed to update compute size', 'error');
      } catch (error) {
        setIsChangingInstanceType(false);
        showToast(
          error instanceof Error ? error.message : 'Failed to update compute size',
          'error'
        );
      }
      return;
    }
  };

  return (
    <>
      <ConfirmDialog {...confirmDialogProps} />
      <MenuDialog open={open} onOpenChange={onOpenChange}>
        <MenuDialogContent>
          <MenuDialogSideNav>
            <MenuDialogSideNavHeader>
              <MenuDialogSideNavTitle>Project Settings</MenuDialogSideNavTitle>
            </MenuDialogSideNavHeader>
            <MenuDialogNav className="gap-0 pb-2">
              <MenuDialogNavList className="gap-1">
                <MenuDialogNavItem
                  icon={<Settings className="size-5" />}
                  active={activeTab === 'info'}
                  onClick={() => setActiveTab('info')}
                >
                  General
                </MenuDialogNavItem>
                <MenuDialogNavItem
                  icon={<Plug className="size-5" />}
                  active={activeTab === 'connect'}
                  onClick={() => setActiveTab('connect')}
                >
                  Connect
                </MenuDialogNavItem>
                {canUseCloudHost && (
                  <MenuDialogNavItem
                    icon={<HardDrive className="size-5" />}
                    active={activeTab === 'compute'}
                    onClick={() => {
                      setActiveTab('compute');
                      void requestInstanceInfo();
                    }}
                  >
                    Compute & Disk
                  </MenuDialogNavItem>
                )}
              </MenuDialogNavList>
            </MenuDialogNav>
          </MenuDialogSideNav>

          <MenuDialogMain>
            <MenuDialogHeader>
              <MenuDialogTitle>{sectionTitle}</MenuDialogTitle>
              <MenuDialogDescription className="sr-only">
                Project settings and configuration
              </MenuDialogDescription>
              <MenuDialogCloseButton className="ml-auto self-start" />
            </MenuDialogHeader>

            <MenuDialogBody
              className={cn('border-b-0 p-4', activeTab === 'info' ? 'gap-0' : 'gap-8')}
            >
              {activeTab === 'info' && (
                <div className="flex w-full flex-col">
                  {isCloud && (
                    <>
                      <div className="flex items-start gap-6">
                        <div className="w-[200px] shrink-0">
                          <p className="py-1.5 text-sm leading-5 text-foreground">Project Name</p>
                        </div>
                        <div className="flex min-w-0 flex-1 items-start gap-1.5">
                          <Input
                            value={
                              canUseCloudHost && isProjectInfoLoading ? 'Loading...' : projectName
                            }
                            onChange={(event) => setProjectName(event.target.value)}
                            onFocus={() => setIsProjectNameFocused(true)}
                            onBlur={() => setIsProjectNameFocused(false)}
                            disabled={canUseCloudHost && isProjectInfoLoading}
                            className={cn(
                              'h-8',
                              canUseCloudHost && isProjectInfoLoading && 'animate-pulse cursor-wait'
                            )}
                          />
                        </div>
                      </div>

                      <div className="flex h-5 items-center">
                        <div className="h-px w-full bg-[var(--alpha-8)]" />
                      </div>
                    </>
                  )}

                  <div className="flex items-start gap-6">
                    <div className="w-[200px] shrink-0">
                      <p className="py-1.5 text-sm leading-5 text-foreground">Project URL</p>
                    </div>
                    <div className="flex min-w-0 flex-1 items-start gap-1.5">
                      <div className={INFO_FIELD_CLASS}>
                        <span className="min-w-0 flex-1 truncate">{projectUrl}</span>
                        <CopyButton
                          text={projectUrl}
                          showText={false}
                          className="ml-2 shrink-0 text-muted-foreground hover:text-foreground"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex h-5 items-center">
                    <div className="h-px w-full bg-[var(--alpha-8)]" />
                  </div>

                  <div className="flex items-start gap-6">
                    <div className="w-[200px] shrink-0">
                      <p className="py-1.5 text-sm leading-5 text-foreground">API Key</p>
                      <p className="pb-2 text-[13px] leading-[18px] text-muted-foreground">
                        This key has full access control to your project and should be kept secure.
                        Do not expose this key in your frontend code.
                      </p>
                    </div>
                    <div className="flex min-w-0 flex-1 items-start gap-1.5">
                      <div className={cn(INFO_FIELD_CLASS, isApiKeyLoading && 'animate-pulse')}>
                        <span className="min-w-0 flex-1 truncate">
                          {isApiKeyLoading ? 'Loading...' : maskedApiKey}
                        </span>
                        {!isApiKeyLoading && apiKey && (
                          <CopyButton
                            text={apiKey}
                            showText={false}
                            className="ml-2 shrink-0 text-muted-foreground hover:text-foreground"
                          />
                        )}
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() => void handleRotateApiKey()}
                        disabled={isApiKeyLoading || isRotatingApiKey}
                        className="h-8 shrink-0 rounded border-[var(--alpha-8)] bg-card px-3 text-sm font-medium"
                      >
                        <RefreshCw
                          className={cn('mr-1.5 size-3.5', isRotatingApiKey && 'animate-spin')}
                        />
                        {isRotatingApiKey ? 'Rotating...' : 'Rotate'}
                      </Button>
                    </div>
                  </div>

                  <div className="flex h-5 items-center">
                    <div className="h-px w-full bg-[var(--alpha-8)]" />
                  </div>

                  <div className="flex items-start gap-6">
                    <div className="w-[200px] shrink-0">
                      <p className="py-1.5 text-sm leading-5 text-foreground">Version</p>
                    </div>
                    <div className="flex min-w-0 flex-1 items-start gap-1.5">
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className={cn(INFO_FIELD_CLASS, isVersionLoading && 'animate-pulse')}>
                          <span className="truncate">
                            {isVersionLoading ? 'Loading...' : version || 'Unknown'}
                          </span>
                        </div>
                        {latestVersion && isVersionOutdated && (
                          <p className="text-[13px] leading-[18px] text-muted-foreground">
                            {latestVersion} is available for upgrade
                          </p>
                        )}
                      </div>
                      {canUseCloudHost && isVersionOutdated && (
                        <Button
                          onClick={() => void handleUpdateVersion()}
                          disabled={isUpdatingVersion}
                          className="h-8 rounded px-3 text-sm font-medium"
                        >
                          {isUpdatingVersion ? 'Upgrading...' : 'Upgrade'}
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="flex h-5 items-center">
                    <div className="h-px w-full bg-[var(--alpha-8)]" />
                  </div>

                  {canUseCloudHost && (
                    <div className="flex items-start gap-6">
                      <div className="w-[200px] shrink-0">
                        <p className="py-1.5 text-sm leading-5 text-foreground">Delete Project</p>
                      </div>
                      <div className="flex min-w-0 flex-1 items-start justify-end gap-1.5">
                        <Button
                          variant="destructive"
                          onClick={() => void handleDeleteProject()}
                          className="h-8 rounded px-3 text-sm font-medium"
                        >
                          Delete Project
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'connect' && (
                <div className="flex w-full flex-col">
                  {canUseCloudHost && (
                    <>
                      <div className="flex items-start gap-6">
                        <div className="w-[200px] shrink-0">
                          <p className="py-1.5 text-sm leading-5 text-foreground">CLI</p>
                          <p className="pb-2 text-[13px] leading-[18px] text-muted-foreground">
                            Link this cloud project with InsForge CLI and verify the connection.
                          </p>
                        </div>
                        <div className="flex min-w-0 flex-1 items-start gap-1.5">
                          <CLISection className="w-full gap-4" />
                        </div>
                      </div>

                      <div className="flex h-5 items-center">
                        <div className="h-px w-full bg-[var(--alpha-8)]" />
                      </div>
                    </>
                  )}

                  <div className="flex items-start gap-6">
                    <div className="w-[200px] shrink-0">
                      <p className="py-1.5 text-sm leading-5 text-foreground">MCP</p>
                      <p className="pb-2 text-[13px] leading-[18px] text-muted-foreground">
                        Install the MCP server so your coding agent can access and build the
                        backend.
                      </p>
                    </div>
                    <div className="flex min-w-0 flex-1 items-start gap-1.5">
                      <MCPSection
                        apiKey={apiKey || ''}
                        appUrl={projectUrl}
                        isLoading={isApiKeyLoading}
                        className="w-full gap-3"
                      />
                    </div>
                  </div>

                  {isCloud && (
                    <>
                      <div className="flex h-5 items-center">
                        <div className="h-px w-full bg-[var(--alpha-8)]" />
                      </div>

                      <div className="flex items-start gap-6">
                        <div className="w-[200px] shrink-0">
                          <p className="py-1.5 text-sm leading-5 text-foreground">
                            Connection String
                          </p>
                          <p className="pb-2 text-[13px] leading-[18px] text-muted-foreground">
                            Ideal for applications with persistent and long-lived connections, such
                            as those running on virtual machines or long-standing containers.
                          </p>
                        </div>
                        <div className="flex min-w-0 flex-1 items-start gap-1.5">
                          <ConnectionStringSection className="w-full" />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeTab === 'compute' && canUseCloudHost && (
                <div className="flex w-full flex-col gap-4">
                  {!instanceInfo ? (
                    <div className={cn(INFO_FIELD_CLASS, 'justify-between')}>
                      <span className="text-muted-foreground">Loading compute options...</span>
                    </div>
                  ) : (
                    <>
                      {instanceInfo.planName === 'free' && (
                        <div className="flex flex-col gap-2 rounded border border-[var(--alpha-12)] bg-[var(--alpha-4)] p-3">
                          <p className="text-sm leading-5 text-foreground">
                            Compute upgrades are available on Start plan and above.
                          </p>
                          <div className="flex justify-end">
                            <Button
                              type="button"
                              className="h-8 rounded px-3 text-sm font-medium"
                              onClick={() => host.onNavigateToSubscription?.()}
                            >
                              Upgrade Plan
                            </Button>
                          </div>
                        </div>
                      )}

                      <div className="grid gap-3 md:grid-cols-2">
                        {instanceInfo.instanceTypes.map((instanceType) => {
                          const isCurrent = instanceType.id === instanceInfo.currentInstanceType;
                          const isSelected = instanceType.id === selectedInstanceType;
                          const isFreePlan = instanceInfo.planName === 'free';
                          const isDisabled = isChangingInstanceType || (isFreePlan && !isCurrent);

                          return (
                            <button
                              key={instanceType.id}
                              type="button"
                              disabled={isDisabled}
                              onClick={() => {
                                if (!isCurrent) {
                                  setSelectedInstanceType(instanceType.id);
                                }
                              }}
                              className={cn(
                                'flex flex-col gap-3 rounded border p-3 text-left transition-colors',
                                isDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                                isCurrent
                                  ? 'border-foreground bg-[var(--alpha-4)]'
                                  : isSelected
                                    ? 'border-primary bg-[var(--alpha-4)]'
                                    : 'border-[var(--alpha-12)] hover:border-[var(--alpha-16)]'
                              )}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium text-foreground">
                                  {instanceType.id}
                                </span>
                                {isCurrent ? (
                                  <span className="text-xs text-muted-foreground">Current</span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    ${instanceType.pricePerHour.toFixed(4)} / hour
                                  </span>
                                )}
                              </div>
                              <div className="space-y-1">
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <HardDrive className="size-3.5 shrink-0" />
                                  <span>{instanceType.ram}</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Cpu className="size-3.5 shrink-0" />
                                  <span>{instanceType.cpu}</span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </MenuDialogBody>
            {showProjectNameActions && (
              <MenuDialogFooter className="border-t border-[var(--alpha-8)]">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleCancelProjectNameEdit}
                  className="h-8 rounded border-[var(--alpha-8)] bg-card px-3 text-sm font-medium"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    void handleSaveProjectName();
                  }}
                  disabled={!isProjectNameDirty}
                  className="h-8 rounded px-3 text-sm font-medium"
                >
                  Save
                </Button>
              </MenuDialogFooter>
            )}
            {showComputeActions && (
              <MenuDialogFooter className="border-t border-[var(--alpha-8)]">
                <div className="mr-auto text-sm text-muted-foreground">
                  {projectedComputeCost && (
                    <span>
                      Projected monthly compute after credits:{' '}
                      <span className="text-foreground">
                        ${projectedComputeCost.afterCredits.toFixed(2)}
                      </span>
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setSelectedInstanceType(null)}
                  className="h-8 rounded border-[var(--alpha-8)] bg-card px-3 text-sm font-medium"
                  disabled={isChangingInstanceType}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    void handleChangeInstanceType();
                  }}
                  disabled={isChangingInstanceType}
                  className="h-8 rounded px-3 text-sm font-medium"
                >
                  {isChangingInstanceType ? 'Applying...' : 'Apply Changes'}
                </Button>
              </MenuDialogFooter>
            )}
          </MenuDialogMain>
        </MenuDialogContent>
      </MenuDialog>
    </>
  );
}
