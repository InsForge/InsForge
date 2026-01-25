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

  // Separate step completion state for each install method
  const [step1CompletedByMethod, setStep1CompletedByMethod] = useState<
    Record<InstallMethod, boolean>
  >({
    terminal: false,
    extension: false,
  });
  const [selectedAgentSlug, setSelectedAgentSlug] = useState(MCP_AGENTS[0].slug);
  const [installMethod, setInstallMethod] = useState<InstallMethod>(DEFAULT_OVERLAY_TABS[0].id);

  // Helper to check if current method's step 1 is completed
  const isStep1Completed = step1CompletedByMethod[installMethod];

  // Helper to mark current method's step 1 as completed
  const markStep1Completed = () => {
    setStep1CompletedByMethod((prev) => ({
      ...prev,
      [installMethod]: true,
    }));
  };

  const displayApiKey = isApiKeyLoading ? 'ik_' + '*'.repeat(32) : apiKey || '';

  const isCloudEnvironment = isInsForgeCloudProject();
  const isLoading = isApiKeyLoading || isMcpLoading;
  const shouldShow = isCloudEnvironment && (isLoading || !hasCompletedOnboarding);
  const isOnDashboardPage = location.pathname === '/dashboard';

  // Listen for MCP connection events to auto-advance to step 2
  useEffect(() => {
    if (!socket) {
      return;
    }

    const handleMcpConnected = () => {
      // Mark step 1 as completed for the current install method
      setStep1CompletedByMethod((prev) => ({
        ...prev,
        [installMethod]: true,
      }));
    };

    socket.on(ServerEvents.MCP_CONNECTED, handleMcpConnected);
    return () => {
      socket.off(ServerEvents.MCP_CONNECTED, handleMcpConnected);
    };
  }, [socket, installMethod]);

  // If not on dashboard page or not in cloud environment, don't show the onboarding overlay
  if (!shouldShow || !isOnDashboardPage) {
    return null;
  }

  // Show loading state while checking onboarding status
  if (isLoading) {
    return (
      <div className="absolute inset-0 z-50 dark:bg-[#1E1E1E] bg-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-gray-300 dark:border-neutral-600 border-t-emerald-500 dark:border-t-emerald-400 rounded-full animate-spin" />
          <p className="text-sm text-gray-500 dark:text-neutral-400">Loading...</p>
        </div>
      </div>
    );
  }

  // Main onboarding overlay for /dashboard page
  return (
    <div className="absolute inset-0 z-50 dark:bg-[#1E1E1E] bg-white flex flex-col">
      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto scrollbar-gutter-stable">
        <div className="w-full max-w-[612px] mx-auto px-4 pb-8">
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
          <div className="flex flex-col gap-6 pb-6">
            <OnboardingStep
              stepNumber={1}
              title="Install InsForge"
              isCompleted={isStep1Completed}
              onNext={markStep1Completed}
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
      </div>

      {/* Help Section - fixed at bottom, does not scroll */}
      <div className="shrink-0 flex flex-col items-center w-full px-4 pt-6 pb-10 dark:bg-[#1B1B1B] bg-neutral-100 border-t dark:border-white/8 border-gray-50">
        <HelpSection agentSlug={selectedAgentSlug} installMethod={installMethod} />
      </div>
    </div>
  );
}
