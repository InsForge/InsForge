import { Link } from 'react-router-dom';
import { Smartphone } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, Button, TooltipProvider } from '@/components';
import { McpConnectionSection } from './McpConnectionSection';
import { useApiKey } from '@/lib/hooks/useMetadata';
import { getBackendUrl, isInsForgeCloudProject, isIframe } from '@/lib/utils/utils';
import { postMessageToParent } from '@/lib/utils/cloudMessaging';
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

  const { apiKey, isLoading } = useApiKey();
  const appUrl = getBackendUrl();

  const displayApiKey = isLoading ? 'ik_' + '*'.repeat(32) : apiKey || '';
  const isCloudEnvironment = isInsForgeCloudProject();
  const isInIframe = isIframe();

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
        <DialogContent className="max-w-[640px] bg-white dark:bg-neutral-800 dark:border-neutral-700 p-0 gap-6">
          <DialogTitle className="sr-only">Connect Project</DialogTitle>

          {/* Header Section */}
          <div className="flex flex-col gap-6 px-6 pt-6">
            <h3 className="text-gray-900 dark:text-white text-2xl font-semibold leading-8 tracking-[-0.144px]">
              Connect Project
            </h3>
          </div>

          {/* Tab Content */}
          <div className="flex flex-col gap-10 px-6 overflow-hidden">
            <McpConnectionSection apiKey={displayApiKey} appUrl={appUrl} isLoading={isLoading} />
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 dark:text-neutral-400 text-sm leading-6">
                  Need help?
                </span>
                {isCloudEnvironment && isInIframe && (
                  <Button
                    variant="ghost"
                    onClick={() => postMessageToParent({ type: 'SHOW_CONTACT_MODAL' })}
                    className="gap-1.5 px-2 py-1 h-auto text-white group hover:bg-transparent"
                  >
                    <Smartphone className="w-5 h-5" />
                    <span className="text-sm font-medium group-hover:underline">Text Us</span>
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 dark:text-neutral-400 text-sm leading-6">
                  Join our
                </span>
                <a
                  href="https://discord.gg/DvBtaEc9Jz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:underline"
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
          <div className="flex items-center justify-between p-6 border-t border-neutral-200 dark:border-neutral-700">
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
