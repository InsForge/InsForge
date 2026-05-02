import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  TooltipProvider,
} from '@insforge/ui';
import { MCPSection } from './MCPSection';
import { APIKeysSection } from './APIKeysSection';
import { ConnectionStringSection } from './ConnectionStringSection';
import { CLISection } from './CLISection';
import { useApiKey } from '#lib/hooks/useMetadata';
import { useAnonToken } from '#features/auth/hooks/useAnonToken';
import { useIsCloudHostingMode } from '#lib/config/DashboardHostContext';
import { cn, getBackendUrl, isInsForgeCloudProject } from '#lib/utils/utils';
import { JoinDiscordCta } from '#features/dashboard/components/JoinDiscordCta';

type ConnectTabId = 'cli' | 'mcp' | 'connection-string' | 'api-keys';

interface ConnectTab {
  id: ConnectTabId;
  label: string;
  showRecommended?: boolean;
  cloudOnly?: boolean;
}

const CONNECT_TABS: ConnectTab[] = [
  { id: 'cli', label: 'CLI', showRecommended: true, cloudOnly: true },
  { id: 'mcp', label: 'MCP' },
  { id: 'connection-string', label: 'Connection String', cloudOnly: true },
  { id: 'api-keys', label: 'API Keys' },
];

interface ConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConnectDialog({ open, onOpenChange }: ConnectDialogProps) {
  const isCloudHostingMode = useIsCloudHostingMode();
  const isCloudProject = isInsForgeCloudProject();
  const canShowCli = isCloudProject && isCloudHostingMode;
  const [activeTab, setActiveTab] = useState<ConnectTabId>(canShowCli ? 'cli' : 'mcp');

  const { apiKey, isLoading: isApiKeyLoading } = useApiKey();
  const { accessToken: anonKey, isLoading: isAnonKeyLoading } = useAnonToken();
  const isApiCredentialsLoading = isApiKeyLoading || isAnonKeyLoading;
  const appUrl = getBackendUrl();
  const visibleTabs = useMemo(
    () =>
      CONNECT_TABS.filter((tab) => {
        if (tab.id === 'cli') {
          return canShowCli;
        }
        return isCloudProject || !tab.cloudOnly;
      }),
    [canShowCli, isCloudProject]
  );

  const displayApiKey = isApiKeyLoading ? 'ik_' + '*'.repeat(32) : apiKey || '';
  const displayAnonKey = isAnonKeyLoading ? 'anon_' + '*'.repeat(36) : anonKey || '';

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(visibleTabs[0].id);
    }
  }, [activeTab, visibleTabs]);

  useEffect(() => {
    if (open) {
      setActiveTab(canShowCli ? 'cli' : 'mcp');
    }
  }, [canShowCli, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <TooltipProvider>
        <DialogContent showCloseButton={false} className="w-[640px] max-w-[640px] gap-0 p-0">
          <div className="border-b border-[var(--alpha-8)] px-4 pt-3">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <DialogTitle>Connect Project</DialogTitle>
                <DialogDescription className="sr-only">
                  Connect your project to the InsForge platform
                </DialogDescription>
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
                          'relative h-auto shrink-0 rounded-none px-0 pb-3 pt-0 text-[13px] leading-[18px] transition-colors before:hidden hover:bg-transparent focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
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
            {canShowCli && activeTab === 'cli' && <CLISection />}
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
            <JoinDiscordCta />
            <Button
              type="button"
              variant="secondary"
              size="default"
              onClick={() => onOpenChange(false)}
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
