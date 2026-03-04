import { useEffect, useMemo, useState } from 'react';
import { Plug, Settings } from 'lucide-react';
import {
  Button,
  CopyButton,
  ConfirmDialog,
  MenuDialog,
  MenuDialogContent,
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
  MenuDialogCloseButton,
} from '@insforge/ui';
import { useApiKey } from '@/lib/hooks/useMetadata';
import { useHealth } from '@/lib/hooks/useHealth';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useModal } from '@/lib/contexts/ModalContext';
import { cn, compareVersions, isIframe, isInsForgeCloudProject } from '@/lib/utils/utils';
import { MCPSection, ConnectionStringSection } from '@/features/onboard';
import { postMessageToParent } from '@/lib/utils/cloudMessaging';

type TabType = 'info' | 'connect';

const INFO_FIELD_CLASS =
  'flex h-8 w-full items-center rounded border border-[var(--alpha-12)] bg-[var(--alpha-4)] px-2.5 text-sm leading-5 text-foreground';

export default function SettingsMenuDialog() {
  const { isSettingsDialogOpen, settingsDefaultTab, closeSettingsDialog } = useModal();
  const [activeTab, setActiveTab] = useState<TabType>('info');
  const [projectName, setProjectName] = useState('');
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [isVersionOutdated, setIsVersionOutdated] = useState(false);
  const [isUpdatingVersion, setIsUpdatingVersion] = useState(false);

  const { apiKey, isLoading: isApiKeyLoading } = useApiKey();
  const { version, isLoading: isVersionLoading } = useHealth();
  const { confirm, confirmDialogProps } = useConfirm();

  const isCloud = isInsForgeCloudProject();
  const isInIframe = isIframe();
  const projectUrl = useMemo(() => `${window.location.origin.replace(/\/$/, '')}/`, []);

  const maskedApiKey = apiKey ? `ik_${'*'.repeat(22)}` : 'ik_**********************';

  const sectionTitle = activeTab === 'connect' ? 'Connect Project' : 'Project Information';

  useEffect(() => {
    if (isSettingsDialogOpen) {
      setActiveTab(settingsDefaultTab === 'connect' ? 'connect' : 'info');
      return;
    }

    setIsUpdatingVersion(false);
  }, [isSettingsDialogOpen, settingsDefaultTab]);

  useEffect(() => {
    if (!isCloud || !isInIframe) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PROJECT_INFO') {
        if (event.data.name) {
          setProjectName(event.data.name);
        }

        if (event.data.latestVersion) {
          setLatestVersion(event.data.latestVersion);
        }
      }

      if (event.data?.type === 'VERSION_UPDATE_STARTED') {
        setIsUpdatingVersion(true);
      }
    };

    window.addEventListener('message', handleMessage);
    postMessageToParent({ type: 'REQUEST_PROJECT_INFO' }, '*');

    return () => window.removeEventListener('message', handleMessage);
  }, [isCloud, isInIframe]);

  useEffect(() => {
    if (version && latestVersion) {
      const comparison = compareVersions(version, latestVersion);
      setIsVersionOutdated(comparison < 0);
    }
  }, [version, latestVersion]);

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

  const projectNameDisplay = projectName || 'Project';

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
              </MenuDialogNavList>
            </MenuDialogNav>
          </MenuDialogSideNav>

          <MenuDialogMain>
            <MenuDialogHeader>
              <MenuDialogTitle>{sectionTitle}</MenuDialogTitle>
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
                          <div
                            className={cn(
                              INFO_FIELD_CLASS,
                              isInIframe && !projectName && 'animate-pulse'
                            )}
                          >
                            <span className="truncate">
                              {isInIframe && !projectName ? 'Loading...' : projectNameDisplay}
                            </span>
                          </div>
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
            </MenuDialogBody>
          </MenuDialogMain>
        </MenuDialogContent>
      </MenuDialog>
    </>
  );
}
