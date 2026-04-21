import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Database, X } from 'lucide-react';
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
import { MCPSectionV2 } from './MCPSectionV2';
import { APIKeysSectionV2 } from './APIKeysSectionV2';
import { ConnectionStringSectionV2 } from './ConnectionStringSectionV2';
import { CLISectionV2 } from './CLISectionV2';
import { useApiKey } from '../../../../lib/hooks/useMetadata';
import { useAnonToken } from '../../../auth/hooks/useAnonToken';
import { useIsCloudHostingMode } from '../../../../lib/config/DashboardHostContext';
import { cn, getBackendUrl, isInsForgeCloudProject } from '../../../../lib/utils/utils';
import CLIIcon from '../../../../assets/icons/cli.svg?react';
import MCPIcon from '../../../../assets/icons/mcp.svg?react';
import KeyHorizontalIcon from '../../../../assets/icons/key_horizontal.svg?react';
import { JoinDiscordCta } from '../JoinDiscordCta';

type ConnectTabId = 'cli' | 'mcp' | 'connection-string' | 'api-keys';

interface ConnectTab {
  id: ConnectTabId;
  label: string;
  badge: string;
  badgeType: 'agentic' | 'direct';
  icon: ReactNode;
  cloudOnly?: boolean;
}

const CONNECT_TABS: ConnectTab[] = [
  {
    id: 'cli',
    label: 'CLI',
    badge: 'Agentic Connect',
    badgeType: 'agentic',
    icon: <CLIIcon className="size-6" />,
    cloudOnly: true,
  },
  {
    id: 'mcp',
    label: 'MCP',
    badge: 'Agentic Connect',
    badgeType: 'agentic',
    icon: <MCPIcon className="size-5" />,
  },
  {
    id: 'connection-string',
    label: 'Connection String',
    badge: 'Direct Connect',
    badgeType: 'direct',
    icon: <Database className="size-5" />,
    cloudOnly: true,
  },
  {
    id: 'api-keys',
    label: 'API Keys',
    badge: 'Manage Project Keys',
    badgeType: 'direct',
    icon: <KeyHorizontalIcon className="size-6" />,
  },
];

interface ConnectDialogV2Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConnectDialogV2({ open, onOpenChange }: ConnectDialogV2Props) {
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
        <DialogContent showCloseButton={false} className="w-[800px] max-w-[800px] gap-0 p-0">
          <div className="px-4 pt-3">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <DialogTitle>Connect Project</DialogTitle>
                <DialogDescription className="sr-only">
                  Connect your project to the InsForge platform
                </DialogDescription>
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
            <div className="flex flex-col gap-6">
              {/* Card-style tab navigation */}
              <div className="flex overflow-clip rounded border border-[var(--alpha-8)]">
                {visibleTabs.map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        'flex flex-1 flex-col items-center justify-center gap-3 border-r border-[var(--alpha-8)] py-3 transition-colors last:border-r-0',
                        isActive ? 'bg-[var(--alpha-4)]' : 'hover:bg-[var(--alpha-4)]'
                      )}
                    >
                      <div className="flex flex-col items-center gap-3">
                        <span className="text-foreground">{tab.icon}</span>
                        <div className="flex flex-col items-center gap-2">
                          <span className="text-[13px] leading-[18px] text-foreground">
                            {tab.label}
                          </span>
                          <Badge
                            className={cn(
                              'rounded px-2 py-[2px] text-xs font-medium',
                              tab.badgeType === 'agentic'
                                ? 'bg-primary/[0.04] text-primary'
                                : 'bg-[var(--alpha-8)] text-muted-foreground'
                            )}
                          >
                            {tab.badge}
                          </Badge>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Tab content */}
              {canShowCli && activeTab === 'cli' && <CLISectionV2 />}
              {activeTab === 'mcp' && (
                <MCPSectionV2
                  apiKey={displayApiKey}
                  appUrl={appUrl}
                  isLoading={isApiKeyLoading}
                  className="gap-6"
                />
              )}
              {activeTab === 'connection-string' && <ConnectionStringSectionV2 className="gap-4" />}
              {activeTab === 'api-keys' && (
                <APIKeysSectionV2
                  apiKey={displayApiKey}
                  anonKey={displayAnonKey}
                  appUrl={appUrl}
                  isLoading={isApiCredentialsLoading}
                  className="gap-4"
                />
              )}
            </div>
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
