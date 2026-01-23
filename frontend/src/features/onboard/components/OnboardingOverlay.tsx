import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useApiKey } from '@/lib/hooks/useMetadata';
import { getBackendUrl, isInsForgeCloudProject } from '@/lib/utils/utils';
import { useMcpUsage } from '@/features/logs/hooks/useMcpUsage';
import { useSocket, ServerEvents } from '@/lib/contexts/SocketContext';
import { OnboardingStep } from './OnboardingStep';
import { InstallStep } from './steps/InstallStep';
import { VerifyConnectionStep } from './steps/VerifyConnectionStep';
import { PluginInstallStep } from './steps/PluginInstallStep';
import { ExtensionSetupStep } from './steps/ExtensionSetupStep';
import { HelpSection } from './HelpSection';
import { InstallMethodTabs, DEFAULT_OVERLAY_TABS, type InstallMethod } from './InstallMethodTabs';
import { MCP_AGENTS } from './mcp/helpers';

export function OnboardingOverlay() {
  const location = useLocation();
  const { apiKey, isLoading: isApiKeyLoading } = useApiKey();
  const appUrl = getBackendUrl();
  const { hasCompletedOnboarding, isLoading: isMcpLoading } = useMcpUsage();
  const { socket } = useSocket();

  const [isStep1Completed, setIsStep1Completed] = useState(false);
  const [selectedAgentSlug, setSelectedAgentSlug] = useState(MCP_AGENTS[0].slug);
  const [installMethod, setInstallMethod] = useState<InstallMethod>(DEFAULT_OVERLAY_TABS[0].id);

  const displayApiKey = isApiKeyLoading ? 'ik_' + '*'.repeat(32) : apiKey || '';

  const isCloudEnvironment = isInsForgeCloudProject();
  const isLoading = isApiKeyLoading || isMcpLoading;
  const shouldShow = isCloudEnvironment && !isLoading && !hasCompletedOnboarding;
  const isOnDashboardPage = location.pathname === '/dashboard';

  // Listen for MCP connection events to auto-advance to step 2
  useEffect(() => {
    if (!socket) {
      return;
    }

    const handleMcpConnected = () => {
      setIsStep1Completed(true);
    };

    socket.on(ServerEvents.MCP_CONNECTED, handleMcpConnected);
    return () => {
      socket.off(ServerEvents.MCP_CONNECTED, handleMcpConnected);
    };
  }, [socket]);

  // If not on dashboard page or not in cloud environment, don't show the onboarding overlay
  if (!shouldShow || !isOnDashboardPage) {
    return null;
  }

  // Main onboarding overlay for /dashboard page
  return (
    <div className="absolute inset-0 z-50 dark:bg-[#1E1E1E] bg-white flex items-center justify-center overflow-y-auto">
      <div className="w-full max-w-[612px] flex flex-col justify-between h-full">
        <div className="flex-1 pb-20">
          {/* Header */}
          <div className="text-center mt-10 mb-6">
            <h1 className="text-black dark:text-white text-2xl font-semibold mb-2 tracking-[-0.144px]">
              Get Started
            </h1>
            <p className="dark:text-neutral-400 text-gray-500 text-sm leading-6">
              Turn your AI coding agent into a full stack builder by connecting InsForge.
            </p>
          </div>

          {/* Install Method Tabs */}
          <InstallMethodTabs
            tabs={DEFAULT_OVERLAY_TABS}
            value={installMethod}
            onChange={setInstallMethod}
            className="mb-6"
          />

          {/* Steps */}
          <div className="flex flex-col gap-6 flex-1 overflow-y-auto">
            <OnboardingStep
              stepNumber={1}
              title="Install InsForge"
              isCompleted={isStep1Completed}
              onNext={() => setIsStep1Completed(true)}
            >
              {installMethod === 'terminal' && (
                <InstallStep
                  apiKey={displayApiKey}
                  appUrl={appUrl}
                  isLoading={isApiKeyLoading}
                  onAgentChange={(agent) => setSelectedAgentSlug(agent.slug)}
                />
              )}
              {installMethod === 'extension' && <PluginInstallStep showDescription />}
            </OnboardingStep>

            {isStep1Completed && installMethod === 'terminal' && (
              <OnboardingStep
                stepNumber={2}
                title="Verify Connection"
                isCompleted={hasCompletedOnboarding}
              >
                <VerifyConnectionStep />
              </OnboardingStep>
            )}

            {isStep1Completed && installMethod === 'extension' && (
              <OnboardingStep
                stepNumber={2}
                title="Finish Setup in Extension"
                isCompleted={hasCompletedOnboarding}
              >
                <ExtensionSetupStep />
              </OnboardingStep>
            )}
          </div>
        </div>

        {/* Help Section */}
        <div className="sticky bottom-6 left-0 right-0 flex flex-col items-center">
          <HelpSection
            agentSlug={selectedAgentSlug}
            className="px-4 py-3 rounded-lg dark:bg-[#333333] bg-neutral-100"
          />
        </div>
      </div>
    </div>
  );
}
