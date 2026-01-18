import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApiKey } from '@/lib/hooks/useMetadata';
import { getBackendUrl, isInsForgeCloudProject } from '@/lib/utils/utils';
import { useMcpUsage } from '@/features/logs/hooks/useMcpUsage';
import { useSocket, ServerEvents } from '@/lib/contexts/SocketContext';
import { OnboardingStep } from './OnboardingStep';
import { InstallStep } from './steps/InstallStep';
import { VerifyConnectionStep } from './steps/VerifyConnectionStep';
import { HelpSection } from './HelpSection';
import { MCP_AGENTS } from './mcp/helpers';
import { Button } from '@/components';

export function OnboardingOverlay() {
  const location = useLocation();
  const navigate = useNavigate();
  const { apiKey, isLoading: isApiKeyLoading } = useApiKey();
  const appUrl = getBackendUrl();
  const { hasCompletedOnboarding, isLoading: isMcpLoading } = useMcpUsage();
  const { socket } = useSocket();

  const [isStep1Completed, setIsStep1Completed] = useState(false);
  const [selectedAgentSlug, setSelectedAgentSlug] = useState(MCP_AGENTS[0].slug);

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

  if (!shouldShow) {
    return null;
  }

  // If not on dashboard page, show semi-transparent overlay with redirect prompt
  if (!isOnDashboardPage) {
    return (
      <div className="absolute inset-0 z-50 bg-black/30 flex flex-col justify-end">
        <div className="w-120 mb-10 mx-auto rounded-lg bg-[#333333] border border-neutral-700 pl-4 pr-3 py-3 flex items-center justify-between">
          <span className="text-neutral-300 text-base font-medium">
            Connect Project to get started
          </span>
          <Button
            onClick={() => {
              void navigate('/dashboard');
            }}
            className="h-8 px-3 rounded-md bg-emerald-300 text-black text-sm font-medium hover:bg-emerald-400"
          >
            Connect Project
          </Button>
        </div>
      </div>
    );
  }

  // Main onboarding overlay for /dashboard page
  return (
    <div className="absolute inset-0 z-50 bg-[#1E1E1E] flex items-center justify-center">
      <div className="w-full max-w-[612px] flex flex-col justify-between h-full">
        <div className="flex-1">
          {/* Header */}
          <div className="text-center mt-10 mb-6">
            <h1 className="text-white text-2xl font-semibold mb-2">Get Started</h1>
            <p className="text-neutral-400 text-sm leading-6">
              Turn your AI coding agent into a full stack builder by connecting InsForge.
            </p>
          </div>

          {/* Steps */}
          <div className="flex flex-col gap-6 flex-1 overflow-y-auto">
            <OnboardingStep
              stepNumber={1}
              title="Install InsForge"
              isCompleted={isStep1Completed}
              onNext={() => setIsStep1Completed(true)}
            >
              <InstallStep
                apiKey={displayApiKey}
                appUrl={appUrl}
                isLoading={isApiKeyLoading}
                onAgentChange={(agent) => setSelectedAgentSlug(agent.slug)}
              />
            </OnboardingStep>

            {isStep1Completed && (
              <OnboardingStep
                stepNumber={2}
                title="Verify Connection"
                isCompleted={hasCompletedOnboarding}
              >
                <VerifyConnectionStep />
              </OnboardingStep>
            )}
          </div>
        </div>

        {/* Help Section */}
        <div className="mb-6 flex flex-col items-center">
          <HelpSection agentSlug={selectedAgentSlug} />
        </div>
      </div>
    </div>
  );
}
