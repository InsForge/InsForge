import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  Badge,
  Button,
  CopyButton,
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogTitle,
  TooltipProvider,
} from '@insforge/ui';
import { MCPSection } from './MCPSection';
import { APIKeysSection } from './APIKeysSection';
import { ConnectionStringSection } from './ConnectionStringSection';
import { useApiKey } from '@/lib/hooks/useMetadata';
import { useAnonToken } from '@/features/auth/hooks/useAnonToken';
import { cn, getBackendUrl, isInsForgeCloudProject } from '@/lib/utils/utils';
import { useModal } from '@/lib/hooks/useModal';
import DiscordIcon from '@/assets/logos/discord.svg?react';

const ONBOARDING_SKIPPED_KEY = 'insforge_onboarding_skipped';
const CLI_INSTALL_COMMAND = 'npx insforge cli';

type ConnectTabId = 'cli' | 'mcp' | 'connection-string' | 'api-keys';

interface ConnectTab {
  id: ConnectTabId;
  label: string;
  showRecommended?: boolean;
  cloudOnly?: boolean;
}

const CONNECT_TABS: ConnectTab[] = [
  { id: 'cli', label: 'CLI', showRecommended: true },
  { id: 'mcp', label: 'MCP' },
  { id: 'connection-string', label: 'Connection String', cloudOnly: true },
  { id: 'api-keys', label: 'API Keys' },
];

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

export function ConnectDialog() {
  const { isOnboardingModalOpen, setOnboardingModalOpen } = useModal();
  const [activeTab, setActiveTab] = useState<ConnectTabId>('cli');
  const isCloudProject = isInsForgeCloudProject();

  const { apiKey, isLoading: isApiKeyLoading } = useApiKey();
  const { accessToken: anonKey, isLoading: isAnonKeyLoading } = useAnonToken();
  const isApiCredentialsLoading = isApiKeyLoading || isAnonKeyLoading;
  const appUrl = getBackendUrl();
  const visibleTabs = useMemo(
    () => CONNECT_TABS.filter((tab) => isCloudProject || !tab.cloudOnly),
    [isCloudProject]
  );

  const displayApiKey = isApiKeyLoading ? 'ik_' + '*'.repeat(32) : apiKey || '';
  const displayAnonKey = isAnonKeyLoading ? 'anon_' + '*'.repeat(36) : anonKey || '';

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(visibleTabs[0].id);
    }
  }, [activeTab, visibleTabs]);

  useEffect(() => {
    if (isOnboardingModalOpen) {
      setActiveTab('cli');
    }
  }, [isOnboardingModalOpen]);

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
        <DialogContent showCloseButton={false} className="w-[640px] max-w-[640px] gap-0 p-0">
          <div className="border-b border-[var(--alpha-8)] px-4 pt-3">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <DialogTitle>Connect Project</DialogTitle>
                <div className="mt-3 flex items-start gap-6 overflow-x-auto">
                  {visibleTabs.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                      <Button
                        key={tab.id}
                        type="button"
                        variant="ghost"
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                          'relative h-auto shrink-0 rounded-none px-0 pb-3 pt-0 text-[13px] leading-[18px] transition-colors before:hidden hover:bg-transparent',
                          isActive
                            ? 'text-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        <span>{tab.label}</span>
                        {tab.showRecommended && (
                          <Badge className="rounded bg-[var(--alpha-8)] px-2 py-[2px] text-primary">
                            Recommended
                          </Badge>
                        )}
                        <span
                          className={cn(
                            'absolute bottom-0 left-0 h-0.5 w-full',
                            isActive ? 'bg-foreground' : 'bg-transparent'
                          )}
                        />
                      </Button>
                    );
                  })}
                </div>
              </div>
              <DialogCloseButton
                className="relative right-auto top-auto h-7 w-7 p-1"
                aria-label="Close"
              >
                <X className="size-5" />
              </DialogCloseButton>
            </div>
          </div>

          <DialogBody className="max-h-[60dvh] overflow-y-auto p-4">
            {activeTab === 'cli' && (
              <div className="flex flex-col gap-2">
                <p className="text-sm leading-6 text-muted-foreground">
                  Run the following command in your terminal
                </p>
                <div className="flex items-center gap-2 rounded border border-[var(--alpha-8)] bg-semantic-0 py-3 pl-6 pr-3">
                  <div className="flex min-w-0 flex-1 items-center gap-4 font-mono text-sm text-foreground">
                    <span>$</span>
                    <span className="truncate">{CLI_INSTALL_COMMAND}</span>
                  </div>
                  <CopyButton
                    text={CLI_INSTALL_COMMAND}
                    copyText="Copy"
                    copiedText="Copied"
                    className="shrink-0"
                  />
                </div>
              </div>
            )}
            {activeTab === 'mcp' && (
              <MCPSection
                apiKey={displayApiKey}
                appUrl={appUrl}
                isLoading={isApiKeyLoading}
                className="gap-6"
              />
            )}
            {activeTab === 'connection-string' && <ConnectionStringSection className="gap-4" />}
            {activeTab === 'api-keys' && (
              <APIKeysSection
                apiKey={displayApiKey}
                anonKey={displayAnonKey}
                appUrl={appUrl}
                isLoading={isApiCredentialsLoading}
                className="gap-4"
              />
            )}
          </DialogBody>

          <DialogFooter className="justify-between">
            <p className="flex min-w-0 items-center gap-1 text-sm leading-6 text-muted-foreground">
              <span>Need help? Join our</span>
              <a
                href="https://discord.gg/DvBtaEc9Jz"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[#818cf8] hover:text-[#99a3ff]"
              >
                <DiscordIcon className="size-5" />
                <span>Discord</span>
              </a>
            </p>
            <Button
              type="button"
              variant="secondary"
              size="default"
              onClick={handleSkipOnboarding}
              className="shrink-0"
            >
              I&apos;ll connect later
            </Button>
          </DialogFooter>
        </DialogContent>
      </TooltipProvider>
    </Dialog>
  );
}
