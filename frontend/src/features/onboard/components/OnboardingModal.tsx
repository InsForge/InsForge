import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogTitle, TooltipProvider } from '@/components';
import { McpConnectionSection } from './McpConnectionSection';
import { PluginInstallStep } from './steps/PluginInstallStep';
import { InstallMethodTabs, DEFAULT_MODAL_TABS, type InstallMethod } from './InstallMethodTabs';
import { MCP_AGENTS } from './mcp/helpers';
import { useApiKey } from '@/lib/hooks/useMetadata';
import { getBackendUrl } from '@/lib/utils/utils';
import { HelpSection } from './HelpSection';
import { useModal } from '@/lib/hooks/useModal';

const ONBOARDING_SKIPPED_KEY = 'insforge_onboarding_skipped';

export function getOnboardingSkipped(): boolean {
  return localStorage.getItem(ONBOARDING_SKIPPED_KEY) === 'true';
}

export function setOnboardingSkipped(skipped: boolean): void {
  if (skipped) {
    localStorage.setItem(ONBOARDING_SKIPPED_KEY, 'true');
  } else {
    localStorage.removeItem(ONBOARDING_SKIPPED_KEY);
  }
}

export function OnboardingModal() {
  const { isOnboardingModalOpen, setOnboardingModalOpen } = useModal();
  const [selectedAgentSlug, setSelectedAgentSlug] = useState(MCP_AGENTS[0].slug);
  const [installMethod, setInstallMethod] = useState<InstallMethod>(DEFAULT_MODAL_TABS[0].id);

  const { apiKey, isLoading } = useApiKey();
  const appUrl = getBackendUrl();

  const displayApiKey = isLoading ? 'ik_' + '*'.repeat(32) : apiKey || '';

  const handleSkipOnboarding = () => {
    setOnboardingSkipped(true);
    setOnboardingModalOpen(false);
  };

  const handleModalClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      handleSkipOnboarding();
    }
  };

  return (
    <Dialog open={isOnboardingModalOpen} onOpenChange={handleModalClose}>
      <TooltipProvider>
        <DialogContent className="max-w-[640px] max-h-[calc(100vh-48px)] flex flex-col bg-white dark:bg-neutral-800 dark:border-neutral-700 p-0 gap-6">
          <DialogTitle className="sr-only tracking-[-0.144px] text-2xl">
            Connect Project
          </DialogTitle>

          {/* Header Section */}
          <div className="flex flex-col gap-6 px-6 pt-6 shrink-0">
            <h3 className="text-gray-900 dark:text-white text-2xl font-semibold leading-8 tracking-[-0.144px]">
              Connect Project
            </h3>
            <InstallMethodTabs
              tabs={DEFAULT_MODAL_TABS}
              value={installMethod}
              onChange={setInstallMethod}
              className="dark:bg-neutral-900 bg-neutral-200"
            />
          </div>

          {/* Tab Content */}
          <div className="flex flex-col gap-6 px-6 overflow-y-auto min-h-0 flex-1">
            {installMethod === 'terminal' && (
              <McpConnectionSection
                apiKey={displayApiKey}
                appUrl={appUrl}
                isLoading={isLoading}
                onAgentChange={(agent) => setSelectedAgentSlug(agent.slug)}
              />
            )}
            {installMethod === 'extension' && (
              <PluginInstallStep cardClassName="dark:bg-neutral-900" showDescription={false} />
            )}
            <HelpSection
              agentSlug={selectedAgentSlug}
              className={installMethod === 'terminal' ? 'mt-4' : ''}
            />
          </div>

          {/* Help Section */}
          <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-neutral-700 shrink-0">
            <Link
              to="/dashboard/settings?tab=connect"
              onClick={() => setOnboardingModalOpen(false)}
              className="flex items-center justify-center rounded px-3 h-8 bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-600 text-black dark:text-white border-neutral-300 dark:border-neutral-600 text-sm font-medium"
            >
              Advanced Connection
            </Link>
            {/* <Button
              variant="outline"
              onClick={handleSkipOnboarding}
              className="px-3 h-8 bg-gray-100 dark:bg-neutral-700 hover:bg-gray-200 dark:hover:bg-neutral-600 text-gray-700 dark:text-white border-gray-300 dark:border-neutral-600 text-sm font-medium"
            >
              I&apos;ll connect later
            </Button> */}
          </div>
        </DialogContent>
      </TooltipProvider>
    </Dialog>
  );
}
