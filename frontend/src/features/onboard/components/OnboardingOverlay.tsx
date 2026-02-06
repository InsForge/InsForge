import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useApiKey } from '@/lib/hooks/useMetadata';
import { getBackendUrl, isInsForgeCloudProject } from '@/lib/utils/utils';
import { useMcpUsage } from '@/features/logs/hooks/useMcpUsage';
import { useSocket, ServerEvents } from '@/lib/contexts/SocketContext';
import { OnboardingStep } from './OnboardingStep';
import { InstallStep } from './steps/InstallStep';
import { VerifyConnectionStep } from './steps/VerifyConnectionStep';
import { PluginInstallStep } from './steps/PluginInstallStep';
import { OpenExtensionStep } from './steps/OpenExtensionStep';
import { SelectAgentStep } from './steps/SelectAgentStep';
import { HelpSection } from './HelpSection';
import {
  InstallMethodTabs,
  DEFAULT_OVERLAY_TABS,
  type InstallMethod,
  type InstallMethodTab,
} from './InstallMethodTabs';
import { MCP_AGENTS } from './mcp/helpers';
import { trackPostHog, getFeatureFlag } from '@/lib/analytics/posthog';

export function OnboardingOverlay() {
  const location = useLocation();
  const { apiKey, isLoading: isApiKeyLoading } = useApiKey();
  const appUrl = getBackendUrl();
  const { hasCompletedOnboarding, isLoading: isMcpLoading } = useMcpUsage();
  const { socket } = useSocket();

  // Get experiment variant from PostHog
  const variant = getFeatureFlag('onboarding-method-experiment');

  // Refs for tracking
  const hasTrackedOverlayView = useRef(false);
  const methodSwitchTime = useRef<number>(Date.now());

  // Determine tabs based on experiment variant
  const tabs = useMemo((): InstallMethodTab[] => {
    if (variant === 'test') {
      // Test variant: extension is recommended
      return [
        { id: 'extension', label: 'VSCode Extension', showRecommended: true },
        { id: 'terminal', label: 'Terminal' },
      ];
    }
    // Control variant or undefined: terminal is recommended (default)
    return DEFAULT_OVERLAY_TABS;
  }, [variant]);

  // Default install method based on experiment variant
  const defaultMethod = tabs[0].id;

  // Track current step for each install method (1-indexed)
  // Terminal has 2 steps, Extension has 4 steps
  const [currentStepByMethod, setCurrentStepByMethod] = useState<Record<InstallMethod, number>>({
    terminal: 1,
    extension: 1,
  });
  const [selectedAgentSlug, setSelectedAgentSlug] = useState(MCP_AGENTS[0].slug);
  const [selectedAgentId, setSelectedAgentId] = useState(MCP_AGENTS[0].id);
  const [installMethod, setInstallMethod] = useState<InstallMethod>(defaultMethod);

  // Get current step for the active method
  const currentStep = currentStepByMethod[installMethod];

  // Helper to go to next step
  const goToNextStep = useCallback(() => {
    setCurrentStepByMethod((prev) => ({
      ...prev,
      [installMethod]: prev[installMethod] + 1,
    }));
  }, [installMethod]);

  // Helper to go to previous step
  const goToPrevStep = useCallback(() => {
    setCurrentStepByMethod((prev) => ({
      ...prev,
      [installMethod]: Math.max(1, prev[installMethod] - 1),
    }));
  }, [installMethod]);

  // Handle install method change with tracking
  const handleMethodChange = useCallback(
    (newMethod: InstallMethod) => {
      if (newMethod !== installMethod) {
        trackPostHog('onboarding_action_taken', {
          action_type: 'switch install method',
          experiment_variant: variant,
          method: installMethod,
          new_method: newMethod,
        });
        methodSwitchTime.current = Date.now();
        // Reset step to 1 when switching methods
        setCurrentStepByMethod((prev) => ({
          ...prev,
          [newMethod]: 1,
        }));
      }
      setInstallMethod(newMethod);
    },
    [installMethod, variant]
  );

  // Track install command copied
  const handleInstallationCommandCopied = useCallback(() => {
    trackPostHog('onboarding_action_taken', {
      action_type: 'copy command',
      experiment_variant: variant,
      method: installMethod,
      agent_id: selectedAgentId,
    });
  }, [variant, installMethod, selectedAgentId]);

  // Track verify connection command copied
  const handleVerifyConnectionCommandCopied = useCallback(() => {
    trackPostHog('onboarding_action_taken', {
      action_type: 'copy verify connection command',
      experiment_variant: variant,
      method: installMethod,
      agent_id: selectedAgentId,
    });
  }, [variant, installMethod, selectedAgentId]);

  // Track agent trigger click
  const handleAgentTriggerClick = useCallback(() => {
    trackPostHog('onboarding_action_taken', {
      action_type: 'open agent selector',
      experiment_variant: variant,
      method: installMethod,
    });
  }, [variant, installMethod]);

  // Track agent selection
  const handleAgentChange = useCallback(
    (agent: { id: string; slug: string }) => {
      trackPostHog('onboarding_action_taken', {
        action_type: 'select mcp agent',
        experiment_variant: variant,
        method: installMethod,
        agent_id: agent.id,
        agent_slug: agent.slug,
      });
      setSelectedAgentSlug(agent.slug);
      setSelectedAgentId(agent.id);
    },
    [variant, installMethod]
  );

  const displayApiKey = isApiKeyLoading ? 'ik_' + '*'.repeat(32) : apiKey || '';

  const isCloudEnvironment = isInsForgeCloudProject();
  const isLoading = isApiKeyLoading || isMcpLoading;
  const shouldShow = isCloudEnvironment && (isLoading || !hasCompletedOnboarding);
  const isOnDashboardPage = location.pathname === '/dashboard';

  // Track onboarding overlay viewed (once when shown)
  useEffect(() => {
    if (shouldShow && isOnDashboardPage && !isLoading && !hasTrackedOverlayView.current) {
      hasTrackedOverlayView.current = true;
      methodSwitchTime.current = Date.now();

      trackPostHog('onboarding_overlay_viewed', {
        experiment_variant: variant,
        default_method: defaultMethod,
      });
    }
  }, [shouldShow, isOnDashboardPage, isLoading, variant, defaultMethod]);

  // Listen for MCP connection events to auto-advance steps
  useEffect(() => {
    if (!socket) {
      return;
    }

    const handleMcpConnected = () => {
      // Auto-advance to step 2 for terminal, or next step for extension
      setCurrentStepByMethod((prev) => ({
        ...prev,
        [installMethod]: prev[installMethod] + 1,
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
            tabs={tabs}
            value={installMethod}
            onChange={handleMethodChange}
            className="mb-6"
          />

          {/* Steps */}
          <div className="flex flex-col gap-6 pb-6">
            {/* Terminal Flow: 2 steps */}
            {installMethod === 'terminal' && (
              <>
                <OnboardingStep
                  stepNumber={1}
                  title="Install InsForge"
                  isCompleted={currentStep > 1}
                  onNext={goToNextStep}
                  installMethod={installMethod}
                  experimentVariant={variant as 'control' | 'test'}
                >
                  <InstallStep
                    apiKey={displayApiKey}
                    appUrl={appUrl}
                    isLoading={isApiKeyLoading}
                    onAgentChange={handleAgentChange}
                    onTrigerClick={handleAgentTriggerClick}
                    onCommandCopied={handleInstallationCommandCopied}
                  />
                </OnboardingStep>

                {currentStep >= 2 && (
                  <OnboardingStep
                    stepNumber={2}
                    title="Verify Connection"
                    isCompleted={hasCompletedOnboarding}
                    experimentVariant={variant as 'control' | 'test'}
                    installMethod={installMethod}
                    onBack={goToPrevStep}
                  >
                    <VerifyConnectionStep onPromptCopied={handleVerifyConnectionCommandCopied} />
                  </OnboardingStep>
                )}
              </>
            )}

            {/* Extension Flow: 4 steps */}
            {installMethod === 'extension' && (
              <>
                <OnboardingStep
                  stepNumber={1}
                  title="Install InsForge"
                  isCompleted={currentStep > 1}
                  onNext={goToNextStep}
                  installMethod={installMethod}
                  experimentVariant={variant as 'control' | 'test'}
                >
                  <PluginInstallStep showDescription />
                </OnboardingStep>

                {currentStep >= 2 && (
                  <OnboardingStep
                    stepNumber={2}
                    title="Open InsForge Extension"
                    isCompleted={currentStep > 2}
                    onNext={goToNextStep}
                    onBack={goToPrevStep}
                    installMethod={installMethod}
                    experimentVariant={variant as 'control' | 'test'}
                  >
                    <OpenExtensionStep />
                  </OnboardingStep>
                )}

                {currentStep >= 3 && (
                  <OnboardingStep
                    stepNumber={3}
                    title="Select the Agent"
                    isCompleted={currentStep > 3}
                    onNext={goToNextStep}
                    onBack={goToPrevStep}
                    installMethod={installMethod}
                    experimentVariant={variant as 'control' | 'test'}
                  >
                    <SelectAgentStep />
                  </OnboardingStep>
                )}

                {currentStep >= 4 && (
                  <OnboardingStep
                    stepNumber={4}
                    title="Verify Connection"
                    isCompleted={hasCompletedOnboarding}
                    onBack={goToPrevStep}
                    installMethod={installMethod}
                    experimentVariant={variant as 'control' | 'test'}
                  >
                    <VerifyConnectionStep onPromptCopied={handleVerifyConnectionCommandCopied} />
                  </OnboardingStep>
                )}
              </>
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
