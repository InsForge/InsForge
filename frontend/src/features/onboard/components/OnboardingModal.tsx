import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogTitle, Button, TooltipProvider } from '@/components';
import { McpConnectionSection } from './McpConnectionSection';
import { MCP_SETUP_BASE_URL, MCP_AGENTS } from './mcp/helpers';
import { useApiKey } from '@/lib/hooks/useMetadata';
import { getBackendUrl } from '@/lib/utils/utils';
import DiscordIcon from '@/assets/logos/discord.svg?react';
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

  const { apiKey, isLoading } = useApiKey();
  const appUrl = getBackendUrl();

  const displayApiKey = isLoading ? 'ik_' + '*'.repeat(32) : apiKey || '';
  const guideUrl = `${MCP_SETUP_BASE_URL}#${selectedAgentSlug}`;

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
          <DialogTitle className="sr-only">Connect Project</DialogTitle>

          {/* Header Section */}
          <div className="flex flex-col gap-6 px-6 pt-6 shrink-0">
            <h3 className="text-gray-900 dark:text-white text-2xl font-semibold leading-8 tracking-[-0.144px]">
              Connect Project
            </h3>
          </div>

          {/* Tab Content */}
          <div className="flex flex-col gap-10 px-6 overflow-y-auto min-h-0 flex-1">
            <McpConnectionSection
              apiKey={displayApiKey}
              appUrl={appUrl}
              isLoading={isLoading}
              onAgentChange={(agent) => setSelectedAgentSlug(agent.slug)}
            />
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 dark:text-neutral-400 text-sm leading-6">
                  Need help?
                </span>
                <a
                  href={guideUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm leading-6 font-medium text-white"
                >
                  Step by Step Guide
                </a>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 dark:text-neutral-400 text-sm leading-6">
                  Join our
                </span>
                <a
                  href="https://discord.gg/DvBtaEc9Jz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1"
                >
                  <DiscordIcon className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
                  <span className="text-indigo-500 dark:text-indigo-400 text-sm leading-6 font-medium">
                    Discord
                  </span>
                </a>
                <span className="text-gray-500 dark:text-neutral-400 text-sm leading-6">
                  for live support
                </span>
              </div>
            </div>
          </div>

          {/* Help Section */}
          <div className="flex items-center justify-between p-6 border-t border-neutral-200 dark:border-neutral-700 shrink-0">
            <Link
              to="/dashboard/settings?tab=connect"
              onClick={() => setOnboardingModalOpen(false)}
              className="text-gray-500 dark:text-neutral-400 text-sm font-medium underline"
            >
              Advanced Connection
            </Link>
            <Button
              variant="outline"
              onClick={handleSkipOnboarding}
              className="px-3 h-8 bg-gray-100 dark:bg-neutral-700 hover:bg-gray-200 dark:hover:bg-neutral-600 text-gray-700 dark:text-white border-gray-300 dark:border-neutral-600 text-sm font-medium"
            >
              I&apos;ll connect later
            </Button>
          </div>
        </DialogContent>
      </TooltipProvider>
    </Dialog>
  );
}
