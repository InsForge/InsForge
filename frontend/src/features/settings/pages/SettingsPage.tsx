import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Settings, Info, Plug } from 'lucide-react';
import { CopyButton, TooltipProvider, Input, Button, ConfirmDialog } from '@/components';
import { useApiKey } from '@/lib/hooks/useMetadata';
import { useConfirm } from '@/lib/hooks/useConfirm';
import {
  cn,
  getBackendUrl,
  isInsForgeCloudProject,
  isIframe,
  compareVersions,
} from '@/lib/utils/utils';
import {
  McpConnectionSection,
  ConnectionStringSection,
  ApiCredentialsSection,
} from '@/features/onboard';
import { postMessageToParent } from '@/lib/utils/cloudMessaging';

type TabType = 'info' | 'settings' | 'connect';

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

export default function SettingsPage() {
  const [searchParams] = useSearchParams();

  // Get initial tab from URL param, default to 'info'
  const getInitialTab = (): TabType => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'connect' || tabParam === 'settings' || tabParam === 'info') {
      return tabParam;
    }
    return 'info';
  };

  const [activeTab, setActiveTab] = useState<TabType>(() => getInitialTab());

  const [version, setVersion] = useState<string>('');
  const [isVersionLoading, setIsVersionLoading] = useState(true);
  const [projectName, setProjectName] = useState('');
  const [originalProjectName, setOriginalProjectName] = useState('');
  const [hasNameChanged, setHasNameChanged] = useState(false);
  const [isVersionOutdated, setIsVersionOutdated] = useState(false);
  const [isUpdatingVersion, setIsUpdatingVersion] = useState(false);

  const { apiKey, isLoading: isApiKeyLoading } = useApiKey();
  const { confirm, confirmDialogProps } = useConfirm();
  const isCloud = isInsForgeCloudProject();
  const isInIframe = isIframe();
  const projectUrl = window.location.origin;

  // Masked API key display
  const maskedApiKey = apiKey ? `ik_${'•'.repeat(32)}` : '';

  // Fetch version on mount
  useEffect(() => {
    setIsVersionLoading(true);
    const backendUrl = getBackendUrl();

    fetch(`${backendUrl}/api/health`)
      .then((res) => res.json())
      .then((data) => {
        if (data.version) {
          setVersion(`v${data.version}`);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch version:', err);
      })
      .finally(() => {
        setIsVersionLoading(false);
      });
  }, []);

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
        // Handle version info
        if (event.data.latestVersion && event.data.currentVersion) {
          const comparison = compareVersions(event.data.currentVersion, event.data.latestVersion);
          setIsVersionOutdated(comparison < 0);
        }
      }

      // Handle version update started confirmation
      if (event.data?.type === 'VERSION_UPDATE_STARTED') {
        setIsUpdatingVersion(true);
      }
    };

    window.addEventListener('message', handleMessage);

    // Request project info when Settings page mounts
    postMessageToParent({ type: 'REQUEST_PROJECT_INFO' }, '*');

    return () => window.removeEventListener('message', handleMessage);
  }, [isCloud, isInIframe]);

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

  return (
    <>
      <ConfirmDialog {...confirmDialogProps} />
      <main className="h-full bg-bg-gray dark:bg-neutral-800 overflow-hidden py-8">
        <div className="h-full flex flex-col gap-6 w-full max-w-[1080px] mx-auto">
          {/* Header */}
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white tracking-[-0.1px] shrink-0">
            Project Settings
          </h1>

          {/* Content */}
          <div className="flex-1 flex gap-6 min-h-0 overflow-hidden">
            {/* Sidebar Tabs - Fixed, no scroll */}
            <div className="flex flex-col gap-2 w-50 shrink-0">
              <TabButton
                id="info"
                label="Info"
                icon={Info}
                isActive={activeTab === 'info'}
                onClick={() => setActiveTab('info')}
              />

              {/* Only show Settings tab in cloud environment & iframe */}
              {isCloud && isInIframe && (
                <TabButton
                  id="settings"
                  label="Settings"
                  icon={Settings}
                  isActive={activeTab === 'settings'}
                  onClick={() => setActiveTab('settings')}
                />
              )}

              <TabButton
                id="connect"
                label="Connect"
                icon={Plug}
                isActive={activeTab === 'connect'}
                onClick={() => setActiveTab('connect')}
              />
            </div>

            {/* Main Content Area - Independent scroll */}
            <div className="flex-1 flex flex-col gap-6 overflow-y-auto pb-12">
              {activeTab === 'info' && (
                <div className="flex flex-col gap-6 bg-gray-200 dark:bg-[#333333] rounded-lg p-6">
                  <p className="text-base text-gray-900 dark:text-white">Project Information</p>

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
                      <div
                        className={cn(
                          'h-9 flex items-center justify-between gap-2 text-sm bg-gray-100 dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 pl-3 pr-2 rounded-lg',
                          isApiKeyLoading && 'animate-pulse'
                        )}
                      >
                        <span className="font-mono text-gray-900 dark:text-white">
                          {isApiKeyLoading ? '•'.repeat(35) : maskedApiKey || 'Not available'}
                        </span>
                        {!isApiKeyLoading && apiKey && (
                          <CopyButton
                            text={apiKey}
                            showText={false}
                            className="h-6 w-6 p-1 min-w-0 shrink-0 text-black dark:text-white bg-white dark:bg-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-600 border-none"
                          />
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-neutral-400">
                        This key has full access control to your project and should be kept secure.
                        Do not expose this key in your frontend code.
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
                          className="h-9 text-white dark:text-black bg-black dark:bg-emerald-300 hover:opacity-90 px-3 py-2 rounded-lg"
                        >
                          {isUpdatingVersion ? 'Updating...' : 'Update'}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'settings' && isCloud && isInIframe && (
                <div className="flex flex-col gap-6 bg-gray-200 dark:bg-[#333333] rounded-lg p-6">
                  {/* General Settings Section */}
                  <div className="flex flex-col gap-6">
                    <p className="text-base text-black dark:text-white">General Settings</p>

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
                          className="w-80 h-9 text-sm bg-gray-100 dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded-lg text-gray-900 dark:text-white"
                        />
                        <Button
                          onClick={handleSaveProjectName}
                          disabled={!hasNameChanged}
                          className={cn(
                            'h-9 text-white dark:text-black bg-black dark:bg-emerald-300 hover:opacity-90 px-3 py-2 rounded-lg',
                            !hasNameChanged && 'opacity-40'
                          )}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="bg-gray-200 dark:bg-neutral-700 h-px w-full" />

                  {/* Delete Project Section */}
                  <div className="flex flex-col gap-6">
                    <p className="text-base text-gray-900 dark:text-white">Delete Project</p>
                    <Button
                      variant="destructive"
                      onClick={() => void handleDeleteProject()}
                      className="w-30 bg-red-600 hover:bg-red-700 text-white dark:bg-red-200 dark:hover:bg-red-300 dark:text-red-700"
                    >
                      Delete Project
                    </Button>
                  </div>
                </div>
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
                        <p className="text-base text-gray-900 dark:text-white">API Credentials</p>
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
          </div>
        </div>
      </main>
    </>
  );
}
