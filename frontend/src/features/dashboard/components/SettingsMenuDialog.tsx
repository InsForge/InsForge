import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Cpu, Gauge, HardDrive, Plug, Settings } from 'lucide-react';
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
import type {
  GetRateLimitConfigResponse,
  InstanceInfoEvent,
  UpdateRateLimitConfigRequest,
} from '@insforge/shared-schemas';
import { useApiKey } from '@/lib/hooks/useMetadata';
import { useHealth } from '@/lib/hooks/useHealth';
import {
  CLOUD_PROJECT_INFO_QUERY_KEY,
  useCloudProjectInfo,
  type CloudProjectInfo,
} from '@/lib/hooks/useCloudProjectInfo';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useToast } from '@/lib/hooks/useToast';
import { useModal } from '@/lib/contexts/ModalContext';
import { cn, compareVersions, isIframe, isInsForgeCloudProject } from '@/lib/utils/utils';
import { MCPSection, CLISection, ConnectionStringSection } from '@/features/connect';
import { postMessageToParent } from '@/lib/utils/cloudMessaging';
import { useRateLimitConfig } from '@/features/dashboard/hooks/useRateLimitConfig';

type TabType = 'info' | 'compute' | 'connect' | 'rate-limits';

const INFO_FIELD_CLASS =
  'flex h-8 w-full items-center rounded border border-[var(--alpha-12)] bg-[var(--alpha-4)] px-2.5 text-sm leading-5 text-foreground';

type RateLimitFormField =
  | 'apiGlobalMaxRequests'
  | 'apiGlobalWindowMinutes'
  | 'sendEmailOtpMaxRequests'
  | 'sendEmailOtpWindowMinutes'
  | 'verifyOtpMaxAttempts'
  | 'verifyOtpWindowMinutes'
  | 'emailCooldownSeconds';

type RateLimitFormValues = Record<RateLimitFormField, string>;

const DEFAULT_RATE_LIMIT_FORM_VALUES: RateLimitFormValues = {
  apiGlobalMaxRequests: '3000',
  apiGlobalWindowMinutes: '15',
  sendEmailOtpMaxRequests: '5',
  sendEmailOtpWindowMinutes: '15',
  verifyOtpMaxAttempts: '10',
  verifyOtpWindowMinutes: '15',
  emailCooldownSeconds: '60',
};

const RATE_LIMIT_BOUNDS: Record<RateLimitFormField, { min: number; max: number }> = {
  apiGlobalMaxRequests: { min: 100, max: 100000 },
  apiGlobalWindowMinutes: { min: 1, max: 1440 },
  sendEmailOtpMaxRequests: { min: 1, max: 100 },
  sendEmailOtpWindowMinutes: { min: 1, max: 1440 },
  verifyOtpMaxAttempts: { min: 1, max: 100 },
  verifyOtpWindowMinutes: { min: 1, max: 1440 },
  emailCooldownSeconds: { min: 5, max: 3600 },
};

function toRateLimitFormValues(config?: GetRateLimitConfigResponse | null): RateLimitFormValues {
  if (!config) {
    return { ...DEFAULT_RATE_LIMIT_FORM_VALUES };
  }

  return {
    apiGlobalMaxRequests: String(config.apiGlobalMaxRequests),
    apiGlobalWindowMinutes: String(config.apiGlobalWindowMinutes),
    sendEmailOtpMaxRequests: String(config.sendEmailOtpMaxRequests),
    sendEmailOtpWindowMinutes: String(config.sendEmailOtpWindowMinutes),
    verifyOtpMaxAttempts: String(config.verifyOtpMaxAttempts),
    verifyOtpWindowMinutes: String(config.verifyOtpWindowMinutes),
    emailCooldownSeconds: String(config.emailCooldownSeconds),
  };
}

function parseRateLimitFormValues(values: RateLimitFormValues): {
  parsed: UpdateRateLimitConfigRequest | null;
  errors: Partial<Record<RateLimitFormField, string>>;
} {
  const errors: Partial<Record<RateLimitFormField, string>> = {};
  const parsed: Partial<Record<RateLimitFormField, number>> = {};

  (Object.keys(values) as RateLimitFormField[]).forEach((field) => {
    const rawValue = values[field].trim();
    const bounds = RATE_LIMIT_BOUNDS[field];
    const numericValue = Number(rawValue);

    if (!rawValue) {
      errors[field] = 'Value is required';
      return;
    }

    if (!Number.isInteger(numericValue)) {
      errors[field] = 'Value must be a whole number';
      return;
    }

    if (numericValue < bounds.min || numericValue > bounds.max) {
      errors[field] = `Must be between ${bounds.min} and ${bounds.max}`;
      return;
    }

    parsed[field] = numericValue;
  });

  if (Object.keys(errors).length > 0) {
    return { parsed: null, errors };
  }

  return {
    parsed: parsed as UpdateRateLimitConfigRequest,
    errors: {},
  };
}

export default function SettingsMenuDialog() {
  const { isSettingsDialogOpen, settingsDefaultTab, closeSettingsDialog } = useModal();
  const [activeTab, setActiveTab] = useState<TabType>('info');
  const [isVersionOutdated, setIsVersionOutdated] = useState(false);
  const [isUpdatingVersion, setIsUpdatingVersion] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectNameInitialValue, setProjectNameInitialValue] = useState('');
  const [isProjectNameFocused, setIsProjectNameFocused] = useState(false);
  const [instanceInfo, setInstanceInfo] = useState<Omit<InstanceInfoEvent, 'type'> | null>(null);
  const [selectedInstanceType, setSelectedInstanceType] = useState<string | null>(null);
  const [isChangingInstanceType, setIsChangingInstanceType] = useState(false);
  const [rateLimitFormValues, setRateLimitFormValues] = useState<RateLimitFormValues>(
    DEFAULT_RATE_LIMIT_FORM_VALUES
  );
  const [rateLimitInitialValues, setRateLimitInitialValues] = useState<RateLimitFormValues>(
    DEFAULT_RATE_LIMIT_FORM_VALUES
  );

  const { apiKey, isLoading: isApiKeyLoading } = useApiKey();
  const { version, isLoading: isVersionLoading } = useHealth();
  const { projectInfo, isLoading: isProjectInfoLoading } = useCloudProjectInfo();
  const {
    config: rateLimitConfig,
    isLoading: isRateLimitConfigLoading,
    isError: isRateLimitConfigError,
    error: rateLimitConfigError,
    isUpdating: isUpdatingRateLimits,
    updateConfig: updateRateLimitConfig,
  } = useRateLimitConfig();
  const { confirm, confirmDialogProps } = useConfirm();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const isCloud = isInsForgeCloudProject();
  const isInIframe = isIframe();
  const projectUrl = useMemo(() => `${window.location.origin.replace(/\/$/, '')}/`, []);

  const maskedApiKey = apiKey ? `ik_${'*'.repeat(22)}` : 'ik_**********************';
  const latestVersion = projectInfo.latestVersion ?? null;

  const sectionTitle =
    activeTab === 'connect'
      ? 'Connect Project'
      : activeTab === 'compute'
        ? 'Compute & Disk'
        : activeTab === 'rate-limits'
          ? 'API Rate Limits'
          : 'Project Information';
  const isProjectNameDirty = projectName !== projectNameInitialValue;
  const isRateLimitDirty = useMemo(() => {
    return (Object.keys(rateLimitFormValues) as RateLimitFormField[]).some(
      (field) => rateLimitFormValues[field] !== rateLimitInitialValues[field]
    );
  }, [rateLimitFormValues, rateLimitInitialValues]);
  const rateLimitValidation = useMemo(
    () => parseRateLimitFormValues(rateLimitFormValues),
    [rateLimitFormValues]
  );
  const rateLimitConfigErrorMessage = useMemo(() => {
    if (!isRateLimitConfigError) {
      return null;
    }

    if (rateLimitConfigError instanceof Error && rateLimitConfigError.message) {
      return rateLimitConfigError.message;
    }

    return 'Failed to load API rate-limit configuration.';
  }, [isRateLimitConfigError, rateLimitConfigError]);
  const isRateLimitConfigUnavailable = isRateLimitConfigError || !rateLimitConfig;
  const showRateLimitActions =
    activeTab === 'rate-limits' && !isRateLimitConfigLoading && !isRateLimitConfigUnavailable;
  const saveRateLimitsDisabled =
    !isRateLimitDirty ||
    !rateLimitValidation.parsed ||
    isUpdatingRateLimits ||
    isRateLimitConfigLoading ||
    isRateLimitConfigUnavailable;
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

  useEffect(() => {
    if (isSettingsDialogOpen) {
      const cloudProjectName = projectInfo.name ?? '';
      const nextTab: TabType =
        settingsDefaultTab === 'connect'
          ? 'connect'
          : settingsDefaultTab === 'compute' && isCloud && isInIframe
            ? 'compute'
            : 'info';

      setActiveTab(nextTab);
      setProjectName(cloudProjectName);
      setProjectNameInitialValue(cloudProjectName);
      setIsProjectNameFocused(false);
      setRateLimitFormValues({ ...DEFAULT_RATE_LIMIT_FORM_VALUES });
      setRateLimitInitialValues({ ...DEFAULT_RATE_LIMIT_FORM_VALUES });

      if (isCloud && isInIframe) {
        postMessageToParent({ type: 'REQUEST_INSTANCE_INFO' }, '*');
      }
      return;
    }

    setIsUpdatingVersion(false);
    setIsChangingInstanceType(false);
    setIsProjectNameFocused(false);
    setSelectedInstanceType(null);
    setRateLimitFormValues({ ...DEFAULT_RATE_LIMIT_FORM_VALUES });
    setRateLimitInitialValues({ ...DEFAULT_RATE_LIMIT_FORM_VALUES });
  }, [isSettingsDialogOpen, settingsDefaultTab, projectInfo.name, isCloud, isInIframe]);

  useEffect(() => {
    if (!isCloud || !isInIframe) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'VERSION_UPDATE_STARTED') {
        setIsUpdatingVersion(true);
      }

      if (event.data?.type === 'INSTANCE_INFO') {
        setInstanceInfo({
          currentInstanceType: event.data.currentInstanceType,
          planName: event.data.planName,
          computeCredits: event.data.computeCredits,
          currentOrgComputeCost: event.data.currentOrgComputeCost,
          instanceTypes: event.data.instanceTypes,
          projects: event.data.projects,
        });
        setSelectedInstanceType(null);
      }

      if (event.data?.type === 'INSTANCE_TYPE_CHANGE_RESULT') {
        setIsChangingInstanceType(false);

        if (event.data.success) {
          const nextInstanceType = event.data.instanceType;
          if (nextInstanceType) {
            setInstanceInfo((prev) =>
              prev
                ? {
                    ...prev,
                    currentInstanceType: nextInstanceType,
                  }
                : prev
            );
            setSelectedInstanceType(null);
          }
          postMessageToParent({ type: 'REQUEST_INSTANCE_INFO' }, '*');
          return;
        }

        showToast(event.data.error || 'Failed to update compute size', 'error');
      }
    };

    window.addEventListener('message', handleMessage);

    return () => window.removeEventListener('message', handleMessage);
  }, [isCloud, isInIframe, showToast]);

  useEffect(() => {
    if (version && latestVersion) {
      const comparison = compareVersions(version, latestVersion);
      setIsVersionOutdated(comparison < 0);
    }
  }, [version, latestVersion]);

  useEffect(() => {
    if (!isSettingsDialogOpen || !isCloud || !isInIframe || isProjectInfoLoading) {
      return;
    }

    if (isProjectNameDirty || isProjectNameFocused) {
      return;
    }

    const cloudProjectName = projectInfo.name ?? '';
    setProjectName(cloudProjectName);
    setProjectNameInitialValue(cloudProjectName);
  }, [
    isSettingsDialogOpen,
    isCloud,
    isInIframe,
    isProjectInfoLoading,
    isProjectNameDirty,
    isProjectNameFocused,
    projectInfo.name,
  ]);

  useEffect(() => {
    if (!isSettingsDialogOpen || isRateLimitConfigLoading || !rateLimitConfig) {
      return;
    }

    const values = toRateLimitFormValues(rateLimitConfig);
    setRateLimitFormValues(values);
    setRateLimitInitialValues(values);
  }, [
    isSettingsDialogOpen,
    isRateLimitConfigLoading,
    rateLimitConfig,
    setRateLimitFormValues,
    setRateLimitInitialValues,
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

    postMessageToParent({ type: 'DELETE_PROJECT' }, '*');
  };

  const handleUpdateVersion = () => {
    postMessageToParent({ type: 'UPDATE_PROJECT_VERSION' }, '*');
  };

  const handleCancelProjectNameEdit = () => {
    setProjectName(projectNameInitialValue);
    setIsProjectNameFocused(false);
  };

  const handleSaveProjectName = () => {
    const nextProjectName = projectName.trim();

    if (!isProjectNameDirty || !nextProjectName) {
      return;
    }

    postMessageToParent(
      {
        type: 'UPDATE_PROJECT_NAME',
        name: nextProjectName,
      },
      '*'
    );

    queryClient.setQueryData<CloudProjectInfo>(CLOUD_PROJECT_INFO_QUERY_KEY, (previous = {}) => ({
      ...previous,
      name: nextProjectName,
    }));

    setProjectName(nextProjectName);
    setProjectNameInitialValue(nextProjectName);
    setIsProjectNameFocused(false);
  };

  const handleChangeInstanceType = () => {
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
    postMessageToParent(
      {
        type: 'REQUEST_INSTANCE_TYPE_CHANGE',
        instanceType: selectedInstanceType,
      },
      '*'
    );
  };

  const handleRateLimitInputChange = (field: RateLimitFormField, value: string) => {
    setRateLimitFormValues((previous) => ({
      ...previous,
      [field]: value,
    }));
  };

  const handleCancelRateLimitChanges = () => {
    setRateLimitFormValues(rateLimitInitialValues);
  };

  const handleSaveRateLimitChanges = () => {
    if (isRateLimitConfigUnavailable) {
      showToast('Rate-limit configuration is unavailable. Please refresh and try again.', 'error');
      return;
    }

    if (!rateLimitValidation.parsed) {
      showToast('Please fix invalid rate-limit values before saving', 'error');
      return;
    }

    void updateRateLimitConfig(rateLimitValidation.parsed)
      .then((updatedConfig) => {
        const nextValues = toRateLimitFormValues(updatedConfig);
        setRateLimitFormValues(nextValues);
        setRateLimitInitialValues(nextValues);
      })
      .catch(() => {
        // Error toast is handled in useRateLimitConfig.
      });
  };

  return (
    <>
      <ConfirmDialog {...confirmDialogProps} />
      <MenuDialog
        open={isSettingsDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeSettingsDialog();
          }
        }}
      >
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
                <MenuDialogNavItem
                  icon={<Gauge className="size-5" />}
                  active={activeTab === 'rate-limits'}
                  onClick={() => setActiveTab('rate-limits')}
                >
                  Rate Limits
                </MenuDialogNavItem>
                {isCloud && isInIframe && (
                  <MenuDialogNavItem
                    icon={<HardDrive className="size-5" />}
                    active={activeTab === 'compute'}
                    onClick={() => {
                      setActiveTab('compute');
                      postMessageToParent({ type: 'REQUEST_INSTANCE_INFO' }, '*');
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
                            value={isInIframe && isProjectInfoLoading ? 'Loading...' : projectName}
                            onChange={(event) => setProjectName(event.target.value)}
                            onFocus={() => setIsProjectNameFocused(true)}
                            onBlur={() => setIsProjectNameFocused(false)}
                            disabled={isInIframe && isProjectInfoLoading}
                            className={cn(
                              'h-8',
                              isInIframe && isProjectInfoLoading && 'animate-pulse cursor-wait'
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
                      {isCloud && isInIframe && isVersionOutdated && (
                        <Button
                          onClick={handleUpdateVersion}
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

                  {isCloud && isInIframe && (
                    <div className="flex items-start gap-6">
                      <div className="w-[200px] shrink-0">
                        <p className="py-1.5 text-sm leading-5 text-foreground">Delete Project</p>
                      </div>
                      <div className="flex min-w-0 flex-1 items-start justify-end gap-1.5">
                        <Button
                          variant="secondary"
                          onClick={() => void handleDeleteProject()}
                          className="h-8 rounded border-[var(--alpha-8)] bg-card px-3 text-sm font-medium"
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
                  {isCloud && isInIframe && (
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

              {activeTab === 'compute' && isCloud && isInIframe && (
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
                              onClick={() => postMessageToParent({ type: 'SHOW_PLAN_MODAL' }, '*')}
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

              {activeTab === 'rate-limits' && (
                <div className="flex w-full flex-col gap-5">
                  <div className="rounded border border-[var(--alpha-12)] bg-[var(--alpha-4)] p-3">
                    <p className="text-sm leading-5 text-foreground">
                      These controls apply to the global `/api` per-IP limiter and
                      authentication-sensitive OTP endpoints.
                    </p>
                  </div>

                  {isRateLimitConfigLoading ? (
                    <div className="flex min-h-[100px] items-center justify-center text-sm text-muted-foreground">
                      Loading rate-limit configuration...
                    </div>
                  ) : isRateLimitConfigUnavailable ? (
                    <div className="rounded border border-destructive/40 bg-destructive/5 p-3">
                      <p className="text-sm leading-5 text-destructive">
                        {rateLimitConfigErrorMessage ||
                          'Rate-limit configuration is unavailable right now.'}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Editing is disabled until the configuration can be loaded successfully.
                      </p>
                    </div>
                  ) : (
                    <div className="flex w-full flex-col gap-4">
                      <div className="flex items-start gap-6">
                        <div className="w-[200px] shrink-0">
                          <p className="py-1.5 text-sm leading-5 text-foreground">
                            Global API (per IP)
                          </p>
                          <p className="pb-2 text-[13px] leading-[18px] text-muted-foreground">
                            Max requests allowed for `/api` routes per window.
                          </p>
                        </div>
                        <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <Input
                              type="number"
                              min={RATE_LIMIT_BOUNDS.apiGlobalMaxRequests.min}
                              max={RATE_LIMIT_BOUNDS.apiGlobalMaxRequests.max}
                              value={rateLimitFormValues.apiGlobalMaxRequests}
                              onChange={(event) =>
                                handleRateLimitInputChange(
                                  'apiGlobalMaxRequests',
                                  event.target.value
                                )
                              }
                              className={cn(
                                rateLimitValidation.errors.apiGlobalMaxRequests &&
                                  'border-destructive'
                              )}
                            />
                            <p className="text-xs text-muted-foreground">Requests</p>
                            {rateLimitValidation.errors.apiGlobalMaxRequests && (
                              <p className="text-xs text-destructive">
                                {rateLimitValidation.errors.apiGlobalMaxRequests}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col gap-1">
                            <Input
                              type="number"
                              min={RATE_LIMIT_BOUNDS.apiGlobalWindowMinutes.min}
                              max={RATE_LIMIT_BOUNDS.apiGlobalWindowMinutes.max}
                              value={rateLimitFormValues.apiGlobalWindowMinutes}
                              onChange={(event) =>
                                handleRateLimitInputChange(
                                  'apiGlobalWindowMinutes',
                                  event.target.value
                                )
                              }
                              className={cn(
                                rateLimitValidation.errors.apiGlobalWindowMinutes &&
                                  'border-destructive'
                              )}
                            />
                            <p className="text-xs text-muted-foreground">Window (minutes)</p>
                            {rateLimitValidation.errors.apiGlobalWindowMinutes && (
                              <p className="text-xs text-destructive">
                                {rateLimitValidation.errors.apiGlobalWindowMinutes}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex h-1 items-center">
                        <div className="h-px w-full bg-[var(--alpha-8)]" />
                      </div>

                      <div className="flex items-start gap-6">
                        <div className="w-[200px] shrink-0">
                          <p className="py-1.5 text-sm leading-5 text-foreground">
                            Send OTP (per IP)
                          </p>
                          <p className="pb-2 text-[13px] leading-[18px] text-muted-foreground">
                            Max email verification/reset requests per window.
                          </p>
                        </div>
                        <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <Input
                              type="number"
                              min={RATE_LIMIT_BOUNDS.sendEmailOtpMaxRequests.min}
                              max={RATE_LIMIT_BOUNDS.sendEmailOtpMaxRequests.max}
                              value={rateLimitFormValues.sendEmailOtpMaxRequests}
                              onChange={(event) =>
                                handleRateLimitInputChange(
                                  'sendEmailOtpMaxRequests',
                                  event.target.value
                                )
                              }
                              className={cn(
                                rateLimitValidation.errors.sendEmailOtpMaxRequests &&
                                  'border-destructive'
                              )}
                            />
                            <p className="text-xs text-muted-foreground">Requests</p>
                            {rateLimitValidation.errors.sendEmailOtpMaxRequests && (
                              <p className="text-xs text-destructive">
                                {rateLimitValidation.errors.sendEmailOtpMaxRequests}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col gap-1">
                            <Input
                              type="number"
                              min={RATE_LIMIT_BOUNDS.sendEmailOtpWindowMinutes.min}
                              max={RATE_LIMIT_BOUNDS.sendEmailOtpWindowMinutes.max}
                              value={rateLimitFormValues.sendEmailOtpWindowMinutes}
                              onChange={(event) =>
                                handleRateLimitInputChange(
                                  'sendEmailOtpWindowMinutes',
                                  event.target.value
                                )
                              }
                              className={cn(
                                rateLimitValidation.errors.sendEmailOtpWindowMinutes &&
                                  'border-destructive'
                              )}
                            />
                            <p className="text-xs text-muted-foreground">Window (minutes)</p>
                            {rateLimitValidation.errors.sendEmailOtpWindowMinutes && (
                              <p className="text-xs text-destructive">
                                {rateLimitValidation.errors.sendEmailOtpWindowMinutes}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex h-1 items-center">
                        <div className="h-px w-full bg-[var(--alpha-8)]" />
                      </div>

                      <div className="flex items-start gap-6">
                        <div className="w-[200px] shrink-0">
                          <p className="py-1.5 text-sm leading-5 text-foreground">
                            Verify OTP (per IP)
                          </p>
                          <p className="pb-2 text-[13px] leading-[18px] text-muted-foreground">
                            Max failed OTP verification attempts per window.
                          </p>
                        </div>
                        <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <Input
                              type="number"
                              min={RATE_LIMIT_BOUNDS.verifyOtpMaxAttempts.min}
                              max={RATE_LIMIT_BOUNDS.verifyOtpMaxAttempts.max}
                              value={rateLimitFormValues.verifyOtpMaxAttempts}
                              onChange={(event) =>
                                handleRateLimitInputChange(
                                  'verifyOtpMaxAttempts',
                                  event.target.value
                                )
                              }
                              className={cn(
                                rateLimitValidation.errors.verifyOtpMaxAttempts &&
                                  'border-destructive'
                              )}
                            />
                            <p className="text-xs text-muted-foreground">Attempts</p>
                            {rateLimitValidation.errors.verifyOtpMaxAttempts && (
                              <p className="text-xs text-destructive">
                                {rateLimitValidation.errors.verifyOtpMaxAttempts}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col gap-1">
                            <Input
                              type="number"
                              min={RATE_LIMIT_BOUNDS.verifyOtpWindowMinutes.min}
                              max={RATE_LIMIT_BOUNDS.verifyOtpWindowMinutes.max}
                              value={rateLimitFormValues.verifyOtpWindowMinutes}
                              onChange={(event) =>
                                handleRateLimitInputChange(
                                  'verifyOtpWindowMinutes',
                                  event.target.value
                                )
                              }
                              className={cn(
                                rateLimitValidation.errors.verifyOtpWindowMinutes &&
                                  'border-destructive'
                              )}
                            />
                            <p className="text-xs text-muted-foreground">Window (minutes)</p>
                            {rateLimitValidation.errors.verifyOtpWindowMinutes && (
                              <p className="text-xs text-destructive">
                                {rateLimitValidation.errors.verifyOtpWindowMinutes}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex h-1 items-center">
                        <div className="h-px w-full bg-[var(--alpha-8)]" />
                      </div>

                      <div className="flex items-start gap-6">
                        <div className="w-[200px] shrink-0">
                          <p className="py-1.5 text-sm leading-5 text-foreground">
                            Per-email cooldown
                          </p>
                          <p className="pb-2 text-[13px] leading-[18px] text-muted-foreground">
                            Minimum time between OTP send requests for the same email address.
                          </p>
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <Input
                            type="number"
                            min={RATE_LIMIT_BOUNDS.emailCooldownSeconds.min}
                            max={RATE_LIMIT_BOUNDS.emailCooldownSeconds.max}
                            value={rateLimitFormValues.emailCooldownSeconds}
                            onChange={(event) =>
                              handleRateLimitInputChange('emailCooldownSeconds', event.target.value)
                            }
                            className={cn(
                              'max-w-[280px]',
                              rateLimitValidation.errors.emailCooldownSeconds &&
                                'border-destructive'
                            )}
                          />
                          <p className="text-xs text-muted-foreground">Cooldown (seconds)</p>
                          {rateLimitValidation.errors.emailCooldownSeconds && (
                            <p className="text-xs text-destructive">
                              {rateLimitValidation.errors.emailCooldownSeconds}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
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
                  onClick={handleSaveProjectName}
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
                  onClick={handleChangeInstanceType}
                  disabled={isChangingInstanceType}
                  className="h-8 rounded px-3 text-sm font-medium"
                >
                  {isChangingInstanceType ? 'Applying...' : 'Apply Changes'}
                </Button>
              </MenuDialogFooter>
            )}
            {showRateLimitActions && (
              <MenuDialogFooter className="border-t border-[var(--alpha-8)]">
                <div className="mr-auto text-sm text-muted-foreground">
                  Changes apply to global API and auth OTP-related limits.
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleCancelRateLimitChanges}
                  className="h-8 rounded border-[var(--alpha-8)] bg-card px-3 text-sm font-medium"
                  disabled={!isRateLimitDirty || isUpdatingRateLimits}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveRateLimitChanges}
                  disabled={saveRateLimitsDisabled}
                  className="h-8 rounded px-3 text-sm font-medium"
                >
                  {isUpdatingRateLimits ? 'Saving...' : 'Save Changes'}
                </Button>
              </MenuDialogFooter>
            )}
          </MenuDialogMain>
        </MenuDialogContent>
      </MenuDialog>
    </>
  );
}
