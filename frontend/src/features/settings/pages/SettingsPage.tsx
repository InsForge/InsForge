import { useState, useEffect } from 'react';
import {
  Info,
  Plug,
  ChartBarBig,
  RefreshCw,
  HardDrive,
  Cpu,
  ArrowRight,
  CircleAlert,
  Loader2,
  CircleCheck,
} from 'lucide-react';
import {
  Button,
  Input,
  TooltipProvider,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogCloseButton,
} from '@insforge/ui';
import { CopyButton, ConfirmDialog } from '@/components';
import { useApiKey } from '@/lib/hooks/useMetadata';
import { useHealth } from '@/lib/hooks/useHealth';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useToast } from '@/lib/hooks/useToast';
import { useModal } from '@/lib/contexts/ModalContext';
import { metadataService } from '@/lib/services/metadata.service';
import type { InstanceInfoEvent } from '@insforge/shared-schemas';
import { cn, isInsForgeCloudProject, isIframe, compareVersions } from '@/lib/utils/utils';
import {
  McpConnectionSection,
  ConnectionStringSection,
  ApiCredentialsSection,
} from '@/features/onboard';
import { postMessageToParent } from '@/lib/utils/cloudMessaging';

type TabType = 'info' | 'usage' | 'compute' | 'connect';

interface TabButtonProps {
  id: TabType;
  label: string;
  icon: React.ElementType;
  isActive: boolean;
  onClick: () => void;
}

function TabButton({ label, icon: Icon, isActive, onClick }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'h-11 flex items-center gap-2.5 p-3 rounded-xl transition-colors cursor-pointer',
        isActive
          ? 'bg-gray-200 dark:bg-neutral-700 text-gray-900 dark:text-white'
          : 'text-gray-500 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-white'
      )}
    >
      <Icon className="w-5 h-5" />
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

export default function SettingsDialog() {
  const { isSettingsDialogOpen, settingsDefaultTab, closeSettingsDialog } = useModal();

  const handleUsageClick = () => {
    postMessageToParent({ type: 'NAVIGATE_TO_USAGE' }, '*');
  };

  const [activeTab, setActiveTab] = useState<TabType>('info');

  useEffect(() => {
    if (isSettingsDialogOpen) {
      setActiveTab(settingsDefaultTab);
    } else {
      setSelectedInstanceType(null);
    }
  }, [isSettingsDialogOpen, settingsDefaultTab]);

  const [projectName, setProjectName] = useState('');
  const [originalProjectName, setOriginalProjectName] = useState('');
  const [hasNameChanged, setHasNameChanged] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [isVersionOutdated, setIsVersionOutdated] = useState(false);
  const [isUpdatingVersion, setIsUpdatingVersion] = useState(false);

  const { apiKey, isLoading: isApiKeyLoading, refetch: refetchApiKey } = useApiKey();
  const { version, isLoading: isVersionLoading } = useHealth();
  const { confirm, confirmDialogProps } = useConfirm();
  const { showToast } = useToast();
  const [isRotatingApiKey, setIsRotatingApiKey] = useState(false);
  const [instanceInfo, setInstanceInfo] = useState<Omit<InstanceInfoEvent, 'type'> | null>(null);
  const [selectedInstanceType, setSelectedInstanceType] = useState<string | null>(null);
  const [isChangingInstance, setIsChangingInstance] = useState(false);
  const [isReviewDialogOpen, setIsReviewDialogOpen] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isResizeComplete, setIsResizeComplete] = useState(false);
  const isCloud = isInsForgeCloudProject();
  const isInIframe = isIframe();
  const projectUrl = window.location.origin;

  // Masked API key display
  const maskedApiKey = apiKey ? `ik_${'•'.repeat(32)}` : '';

  // Listen for messages from cloud parent
  useEffect(() => {
    if (!isCloud || !isInIframe) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PROJECT_INFO') {
        // Handle project name
        if (event.data.name) {
          setProjectName(event.data.name);
          setOriginalProjectName(event.data.name);
        }
        if (event.data.latestVersion) {
          setLatestVersion(event.data.latestVersion);
        }
      }

      // Handle version update started confirmation
      if (event.data?.type === 'VERSION_UPDATE_STARTED') {
        setIsUpdatingVersion(true);
      }

      // Handle instance info response
      if (event.data?.type === 'INSTANCE_INFO') {
        setInstanceInfo({
          currentInstanceType: event.data.currentInstanceType,
          planName: event.data.planName,
          computeCredits: event.data.computeCredits,
          currentOrgComputeCost: event.data.currentOrgComputeCost,
          instanceTypes: event.data.instanceTypes,
        });
        setSelectedInstanceType(null);
      }

      // Handle instance type change result
      if (event.data?.type === 'INSTANCE_TYPE_CHANGE_RESULT') {
        setIsChangingInstance(false);
        setIsResizing(false);
        if (event.data.success) {
          setIsResizeComplete(true);
          if (event.data.instanceType) {
            setInstanceInfo((prev) =>
              prev ? { ...prev, currentInstanceType: event.data.instanceType } : prev
            );
            setSelectedInstanceType(null);
          }
        } else {
          showToast(event.data.error || 'Failed to change instance type', 'error');
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // Request project info when Settings page mounts
    postMessageToParent({ type: 'REQUEST_PROJECT_INFO' }, '*');
    postMessageToParent({ type: 'REQUEST_INSTANCE_INFO' }, '*');

    return () => window.removeEventListener('message', handleMessage);
  }, [isCloud, isInIframe]);

  // Compare versions when both values are available
  useEffect(() => {
    if (version && latestVersion) {
      const comparison = compareVersions(version, latestVersion);
      setIsVersionOutdated(comparison < 0);
    }
  }, [version, latestVersion]);

  const handleProjectNameChange = (value: string) => {
    setProjectName(value);
    setHasNameChanged(value.trim() !== originalProjectName);
  };

  const handleSaveProjectName = () => {
    if (!hasNameChanged || !projectName.trim()) {
      return;
    }
    postMessageToParent({ type: 'UPDATE_PROJECT_NAME', name: projectName.trim() }, '*');
    // Update original name after sending update request
    setOriginalProjectName(projectName.trim());
    setHasNameChanged(false);
  };

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

  const handleInstanceTypeChange = () => {
    if (!selectedInstanceType || selectedInstanceType === instanceInfo?.currentInstanceType) {
      return;
    }

    setIsChangingInstance(true);
    setIsReviewDialogOpen(false);
    closeSettingsDialog();
    setIsResizing(true);
    postMessageToParent(
      { type: 'REQUEST_INSTANCE_TYPE_CHANGE', instanceType: selectedInstanceType },
      '*'
    );
  };

  const handleRotateApiKey = async () => {
    const confirmed = await confirm({
      title: 'Rotate API Key',
      description:
        'This will generate a new API key. The current key will remain valid for 1 hour to allow time for migration. Are you sure you want to proceed?',
      confirmText: 'Rotate Key',
      cancelText: 'Cancel',
      destructive: true,
    });

    if (!confirmed) {
      return;
    }

    setIsRotatingApiKey(true);
    try {
      await metadataService.rotateApiKey(1);
      await refetchApiKey();
      showToast('API key rotated successfully', 'success');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to rotate API key — please try again';
      showToast(errorMessage, 'error');
    } finally {
      setIsRotatingApiKey(false);
    }
  };

  return (
    <>
      <ConfirmDialog {...confirmDialogProps} />
      <Dialog open={isSettingsDialogOpen} onOpenChange={(open) => !open && closeSettingsDialog()}>
        <DialogContent className="max-w-[900px]" showCloseButton={false}>
          <DialogBody className="p-0">
            <div className="flex max-h-[70vh]">
              {/* Left Side Nav */}
              <div className="flex flex-col w-[200px] shrink-0 border-r border-[var(--alpha-8)]">
                <div className="px-4 py-3">
                  <p className="text-base font-medium leading-7 text-gray-900 dark:text-white">
                    Project Settings
                  </p>
                </div>
                <div className="flex flex-col gap-2 flex-1 px-3 pb-2">
                  <TabButton
                    id="info"
                    label="Info"
                    icon={Info}
                    isActive={activeTab === 'info'}
                    onClick={() => setActiveTab('info')}
                  />

                  {/* Only show Usage tab in cloud environment & iframe */}
                  {isCloud && isInIframe && (
                    <TabButton
                      id="usage"
                      label="Usage"
                      icon={ChartBarBig}
                      isActive={false}
                      onClick={handleUsageClick}
                    />
                  )}

                  <TabButton
                    id="connect"
                    label="Connect"
                    icon={Plug}
                    isActive={activeTab === 'connect'}
                    onClick={() => setActiveTab('connect')}
                  />

                  {isCloud && isInIframe && (
                    <TabButton
                      id="compute"
                      label="Compute & Disk"
                      icon={HardDrive}
                      isActive={activeTab === 'compute'}
                      onClick={() => setActiveTab('compute')}
                    />
                  )}
                </div>
              </div>

              {/* Right Content */}
              <div className="flex-1 flex flex-col min-w-0">
                {/* Right Header - active tab name + close */}
                <DialogHeader className="flex-row items-center justify-between">
                  <DialogTitle className="capitalize">
                    {activeTab === 'compute' ? 'Compute & Disk' : activeTab}
                  </DialogTitle>
                  <DialogCloseButton />
                </DialogHeader>

                {/* Main Content Area */}
                <div className="flex-1 flex flex-col gap-6 overflow-y-auto px-6 pt-6 pb-12">
                  {activeTab === 'info' && (
                    <>
                      <div className="flex flex-col gap-6 bg-gray-200 dark:bg-[#333333] rounded-lg p-6">
                        <p className="text-base text-gray-900 dark:text-white">
                          Project Information
                        </p>

                        {/* Project Name */}
                        {isCloud && isInIframe && (
                          <div className="flex items-start gap-10">
                            <label className="text-sm leading-6 text-gray-900 dark:text-white w-25 shrink-0 pt-1.5">
                              Project Name
                            </label>
                            <div className="flex items-center gap-3">
                              <Input
                                type="text"
                                value={projectName}
                                onChange={(e) => handleProjectNameChange(e.target.value)}
                                placeholder="Project name"
                                className="w-80 h-9"
                              />
                              <Button
                                onClick={handleSaveProjectName}
                                disabled={!hasNameChanged}
                                className={cn(
                                  'h-9 px-3 rounded-lg',
                                  !hasNameChanged && 'opacity-40'
                                )}
                              >
                                Save
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Project URL */}
                        <div className="flex items-start gap-10">
                          <label className="text-sm leading-6 text-gray-900 dark:text-white w-25 shrink-0 pt-1.5">
                            Project URL
                          </label>
                          <div className="flex-1 h-9 flex items-center justify-between gap-2 text-sm text-gray-900 dark:text-white bg-gray-100 dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 pl-3 pr-2 rounded-lg">
                            <span className="font-mono truncate">{projectUrl}</span>
                            <CopyButton
                              text={projectUrl}
                              showText={false}
                              className="h-6 w-6 p-1 min-w-0 shrink-0 text-black dark:text-white bg-white dark:bg-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-600 border-none"
                            />
                          </div>
                        </div>

                        {/* API Key */}
                        <div className="flex items-start gap-10">
                          <label className="text-sm leading-6 text-gray-900 dark:text-white w-25 shrink-0 pt-1.5">
                            API Key
                          </label>
                          <div className="flex-1 flex flex-col gap-1">
                            <div className="flex items-center gap-3">
                              <div
                                className={cn(
                                  'flex-1 h-9 flex items-center justify-between gap-2 text-sm bg-gray-100 dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 pl-3 pr-2 rounded-lg',
                                  isApiKeyLoading && 'animate-pulse'
                                )}
                              >
                                <span className="font-mono text-gray-900 dark:text-white">
                                  {isApiKeyLoading
                                    ? '•'.repeat(35)
                                    : maskedApiKey || 'Not available'}
                                </span>
                                {!isApiKeyLoading && apiKey && (
                                  <CopyButton
                                    text={apiKey}
                                    showText={false}
                                    className="h-6 w-6 p-1 min-w-0 shrink-0 text-black dark:text-white bg-white dark:bg-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-600 border-none"
                                  />
                                )}
                              </div>
                              <Button
                                onClick={() => void handleRotateApiKey()}
                                disabled={isApiKeyLoading || isRotatingApiKey}
                                className="h-9 gap-2 px-3 rounded-lg"
                              >
                                <RefreshCw
                                  className={cn('w-4 h-4', isRotatingApiKey && 'animate-spin')}
                                />
                                {isRotatingApiKey ? 'Rotating...' : 'Rotate'}
                              </Button>
                            </div>
                            <p className="text-xs text-gray-500 dark:text-neutral-400">
                              This key has full access control to your project and should be kept
                              secure. Do not expose this key in your frontend code.
                            </p>
                          </div>
                        </div>

                        {/* Version */}
                        <div className="flex items-start gap-10">
                          <label className="text-sm leading-6 text-gray-900 dark:text-white w-25 shrink-0 pt-1.5">
                            Version
                          </label>
                          <div className="flex-1 flex items-center gap-3">
                            <div
                              className={cn(
                                'h-9 w-full flex items-center text-sm text-gray-900 dark:text-white bg-gray-100 dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 pl-3 pr-2 rounded-lg',
                                isVersionLoading && 'animate-pulse'
                              )}
                            >
                              {isVersionLoading ? 'Loading...' : version || 'Unknown'}
                            </div>
                            {isCloud && isInIframe && isVersionOutdated && (
                              <Button
                                onClick={handleUpdateVersion}
                                disabled={isUpdatingVersion}
                                className="h-9 px-3 rounded-lg"
                              >
                                {isUpdatingVersion ? 'Updating...' : 'Update'}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Delete Project Section */}
                      {isCloud && isInIframe && (
                        <div className="flex flex-col gap-6 bg-gray-200 dark:bg-[#333333] rounded-lg p-6">
                          <p className="text-base text-gray-900 dark:text-white">Danger Zone</p>
                          <div className="flex items-center justify-between">
                            <div className="flex flex-col gap-1">
                              <p className="text-sm text-gray-900 dark:text-white">
                                Delete Project
                              </p>
                              <p className="text-xs text-gray-500 dark:text-neutral-400">
                                Once deleted, the project cannot be recovered.
                              </p>
                            </div>
                            <Button
                              variant="destructive"
                              onClick={() => void handleDeleteProject()}
                            >
                              Delete Project
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {activeTab === 'compute' && (
                    <>
                      {!instanceInfo ? (
                        <div className="text-sm text-muted-foreground">
                          Loading instance types...
                        </div>
                      ) : (
                        (() => {
                          const isFree = instanceInfo.planName === 'free';
                          return (
                            <>
                              {isFree && (
                                <div className="flex items-center justify-between rounded border border-[var(--border)] bg-toast px-4 py-3">
                                  <div className="flex items-center gap-2 text-muted-foreground">
                                    <Info className="w-4 h-4 shrink-0" />
                                    <span className="text-sm">
                                      Only Available on Start Plan and above
                                    </span>
                                  </div>
                                  <Button
                                    onClick={() =>
                                      postMessageToParent({ type: 'NAVIGATE_TO_SUBSCRIPTION' }, '*')
                                    }
                                  >
                                    Upgrade Plan
                                  </Button>
                                </div>
                              )}
                              <div
                                className={cn(
                                  'grid grid-cols-2 gap-3',
                                  isFree && 'opacity-60 pointer-events-none'
                                )}
                              >
                                {instanceInfo.instanceTypes.map((instance) => {
                                  const isCurrent =
                                    instance.id === instanceInfo.currentInstanceType;
                                  const isSelected =
                                    !isFree && instance.id === selectedInstanceType;
                                  return (
                                    <button
                                      key={instance.id}
                                      onClick={() =>
                                        !isCurrent &&
                                        !isFree &&
                                        setSelectedInstanceType(instance.id)
                                      }
                                      className={cn(
                                        'flex flex-col gap-2.5 p-4 rounded-lg border text-left transition-colors',
                                        isCurrent
                                          ? 'border-foreground cursor-default'
                                          : isSelected
                                            ? 'border-primary cursor-pointer'
                                            : 'border-[var(--alpha-16)] hover:border-[var(--alpha-12)] cursor-pointer'
                                      )}
                                    >
                                      <div className="flex items-center justify-between w-full">
                                        <span
                                          className={cn(
                                            'text-xs font-medium uppercase px-2 py-0.5 rounded',
                                            isCurrent
                                              ? 'bg-foreground text-[rgb(var(--inverse))]'
                                              : isSelected
                                                ? 'bg-primary text-[rgb(var(--inverse))]'
                                                : 'bg-[var(--alpha-16)] text-foreground'
                                          )}
                                        >
                                          {instance.id}
                                        </span>
                                        <span className="text-sm text-muted-foreground">
                                          <span className="text-foreground">
                                            ${instance.pricePerHour.toFixed(4)}
                                          </span>{' '}
                                          / hour
                                        </span>
                                      </div>
                                      <div className="flex flex-col gap-2">
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                          <HardDrive className="w-4 h-4 shrink-0" />
                                          <span>{instance.ram}</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                          <Cpu className="w-4 h-4 shrink-0" />
                                          <span>{instance.cpu}</span>
                                        </div>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </>
                          );
                        })()
                      )}
                    </>
                  )}

                  {activeTab === 'connect' && (
                    <TooltipProvider>
                      <div className="flex flex-col gap-12 mr-4">
                        <div className="flex flex-col gap-6">
                          <p className="text-black dark:text-white text-base">Recommended</p>
                          {/* MCP Section */}
                          <div className="bg-gray-200 dark:bg-[#333333] rounded-lg p-6 flex flex-col gap-6">
                            <p className="text-base text-gray-900 dark:text-white">MCP</p>
                            <McpConnectionSection
                              apiKey={apiKey || ''}
                              appUrl={projectUrl}
                              isLoading={isApiKeyLoading}
                            />
                          </div>
                        </div>

                        <div className="flex flex-col gap-6">
                          <p className="text-black dark:text-white text-base">Advanced</p>
                          {/* Connection String Section - Only show in cloud environment */}
                          {isCloud && (
                            <div className="bg-gray-200 dark:bg-[#333333] rounded-lg p-6 flex flex-col gap-6">
                              <p className="text-base text-gray-900 dark:text-white">
                                Connection String
                              </p>
                              <ConnectionStringSection />
                            </div>
                          )}

                          {/* API Credentials Section */}
                          <div className="bg-gray-200 dark:bg-[#333333] rounded-lg p-6 flex flex-col gap-6">
                            <p className="text-base text-gray-900 dark:text-white">
                              API Credentials
                            </p>
                            <ApiCredentialsSection
                              apiKey={apiKey || ''}
                              appUrl={projectUrl}
                              isLoading={isApiKeyLoading}
                            />
                          </div>
                        </div>
                      </div>
                    </TooltipProvider>
                  )}
                </div>

                {/* Compute tab footer with additional cost and action buttons */}
                {activeTab === 'compute' &&
                  instanceInfo &&
                  selectedInstanceType &&
                  selectedInstanceType !== instanceInfo.currentInstanceType &&
                  (() => {
                    const currentInstance = instanceInfo.instanceTypes.find(
                      (t) => t.id === instanceInfo.currentInstanceType
                    );
                    const selectedInstance = instanceInfo.instanceTypes.find(
                      (t) => t.id === selectedInstanceType
                    );
                    const additionalCost =
                      (selectedInstance?.pricePerMonth ?? 0) -
                      (currentInstance?.pricePerMonth ?? 0);
                    const credits =
                      instanceInfo.computeCredits === -1 ? Infinity : instanceInfo.computeCredits;
                    const newOrgCost =
                      instanceInfo.currentOrgComputeCost -
                      (currentInstance?.pricePerMonth ?? 0) +
                      (selectedInstance?.pricePerMonth ?? 0);
                    const newOrgCostAfterCredits = Math.max(
                      0,
                      newOrgCost - Math.min(credits, newOrgCost)
                    );
                    const showAdditionalCost = additionalCost > 0 && newOrgCostAfterCredits > 0;

                    return (
                      <div className="flex items-center justify-between border-t border-[var(--alpha-8)] px-6 py-4">
                        {showAdditionalCost ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm text-foreground">Additional Cost:</span>
                            <span className="text-sm text-primary">${additionalCost}/Month</span>
                            <Info className="w-4 h-4 text-muted-foreground" />
                          </div>
                        ) : (
                          <div />
                        )}
                        <div className="flex items-center gap-3">
                          <Button variant="secondary" onClick={() => setSelectedInstanceType(null)}>
                            Cancel
                          </Button>
                          <Button
                            onClick={() => setIsReviewDialogOpen(true)}
                            disabled={isChangingInstance}
                          >
                            {isChangingInstance ? 'Changing...' : 'Review Changes'}
                          </Button>
                        </div>
                      </div>
                    );
                  })()}
              </div>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>

      {/* Review Changes Dialog */}
      <Dialog open={isReviewDialogOpen} onOpenChange={setIsReviewDialogOpen}>
        <DialogContent className="max-w-[780px]" showCloseButton={false}>
          <DialogHeader className="flex-row items-center justify-between">
            <div className="flex flex-col gap-1">
              <DialogTitle>Review Changes</DialogTitle>
              <p className="text-sm text-muted-foreground">
                Changes will be applied shortly once confirmed
              </p>
            </div>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4 p-6">
            {instanceInfo &&
              selectedInstanceType &&
              (() => {
                const currentInstance = instanceInfo.instanceTypes.find(
                  (t) => t.id === instanceInfo.currentInstanceType
                );
                const selectedInstance = instanceInfo.instanceTypes.find(
                  (t) => t.id === selectedInstanceType
                );

                return (
                  <>
                    <div className="flex items-center gap-4">
                      <div className="flex-1 flex items-center justify-between border border-[var(--alpha-16)] rounded-lg p-4">
                        <span className="text-xs font-medium uppercase px-2 py-0.5 rounded bg-[var(--alpha-16)] text-foreground">
                          {currentInstance?.id}
                        </span>
                        <span className="text-sm text-foreground">
                          ${currentInstance?.pricePerMonth ?? 0} / Month
                        </span>
                      </div>
                      <ArrowRight className="w-5 h-5 text-muted-foreground shrink-0" />
                      <div className="flex-1 flex items-center justify-between border border-primary rounded-lg p-4">
                        <span className="text-xs font-medium uppercase px-2 py-0.5 rounded bg-primary text-[rgb(var(--inverse))]">
                          {selectedInstance?.id}
                        </span>
                        <span className="text-sm text-foreground">
                          ${selectedInstance?.pricePerMonth ?? 0} / Month
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-warning">
                        <CircleAlert className="w-4 h-4 shrink-0" />
                        <span className="text-sm">
                          Resizing your Compute will automatically restart your project
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <Button variant="secondary" onClick={() => setIsReviewDialogOpen(false)}>
                          Cancel
                        </Button>
                        <Button onClick={handleInstanceTypeChange}>Confirm Changes</Button>
                      </div>
                    </div>
                  </>
                );
              })()}
          </DialogBody>
        </DialogContent>
      </Dialog>

      {/* Resizing dialog */}
      <Dialog open={isResizing}>
        <DialogContent showCloseButton={false}>
          <DialogBody className="p-6 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-foreground" />
              <span className="text-base font-medium text-foreground">
                Resizing Project Compute Size
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Your project is being restarted to apply compute size changes. This can take a few
              minutes. Project will be offline while it is being restarted
            </p>
          </DialogBody>
        </DialogContent>
      </Dialog>

      {/* Resize complete dialog */}
      <Dialog open={isResizeComplete} onOpenChange={setIsResizeComplete}>
        <DialogContent showCloseButton={false}>
          <DialogHeader className="flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <CircleCheck className="w-5 h-5 text-primary" />
              <DialogTitle>Compute Size Updated</DialogTitle>
            </div>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="p-6">
            <p className="text-sm text-muted-foreground">
              Compute resizing completed. Your project is now back online.
            </p>
          </DialogBody>
          <div className="flex justify-end px-6 pb-6">
            <Button variant="secondary" onClick={() => setIsResizeComplete(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
