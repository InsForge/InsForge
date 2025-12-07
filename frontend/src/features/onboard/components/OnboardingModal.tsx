import { useState, useMemo } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  Button,
  CopyButton,
  CodeBlock,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components';
import { VideoDemoModal } from './VideoDemoModal';
import { CursorDeeplinkGenerator } from './mcp/CursorDeeplinkGenerator';
import { MCP_AGENTS, GenerateInstallCommand, createMCPConfig, type MCPAgent } from './mcp/helpers';
import { useApiKey } from '@/lib/hooks/useMetadata';
import { cn, getBackendUrl } from '@/lib/utils/utils';
import DiscordIcon from '@/assets/logos/discord.svg?react';

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

interface OnboardingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OnboardingModal({ open, onOpenChange }: OnboardingModalProps) {
  const [selectedAgent, setSelectedAgent] = useState<MCPAgent>(MCP_AGENTS[0]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isVideoTooltipOpen, setIsVideoTooltipOpen] = useState(false);

  const { apiKey, isLoading } = useApiKey();
  const appUrl = getBackendUrl();

  const displayApiKey = isLoading ? 'ik_' + '*'.repeat(32) : apiKey || '';

  const installCommand = useMemo(() => {
    return GenerateInstallCommand(selectedAgent, displayApiKey);
  }, [selectedAgent, displayApiKey]);

  const mcpJsonConfig = useMemo(() => {
    const config = createMCPConfig(displayApiKey, 'macos-linux', appUrl);
    return JSON.stringify(config, null, 2);
  }, [displayApiKey, appUrl]);

  const testPrompt =
    "I'm using InsForge as my backend platform, fetch InsForge instruction doc to learn more about InsForge";

  const handleSkipOnboarding = () => {
    setOnboardingSkipped(true);
    onOpenChange(false);
  };

  const handleModalClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      handleSkipOnboarding();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleModalClose}>
      <TooltipProvider>
        <DialogContent className="max-w-[640px] bg-white dark:bg-neutral-800 dark:border-neutral-700 p-6 gap-10">
          <DialogTitle className="sr-only">Connect Project</DialogTitle>

          {/* Header Section */}
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <h3 className="text-gray-900 dark:text-white text-2xl font-semibold leading-8 tracking-[-0.144px]">
                Connect Project
              </h3>
              <div className="flex items-center gap-1">
                <p className="text-gray-500 dark:text-neutral-400 text-base leading-7">
                  Connect your AI agent by installing the MCP server. The installation completes
                  automatically when we receive the first MCP call.
                </p>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      onMouseEnter={() => setIsVideoTooltipOpen(true)}
                      onMouseLeave={() => setIsVideoTooltipOpen(false)}
                      className="cursor-help"
                    >
                      <HelpCircle className="w-5 h-5 text-gray-400 dark:text-neutral-400 shrink-0" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent
                    portal
                    side="bottom"
                    sideOffset={10}
                    className="p-0 bg-transparent border-0 shadow-none z-[100]"
                  >
                    <VideoDemoModal open={isVideoTooltipOpen} className="w-[580px]" />
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Agent Selector Dropdown */}
            <div className="relative">
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="w-40 bg-gray-100 dark:bg-[rgba(0,0,0,0.12)] border border-gray-300 dark:border-[rgba(255,255,255,0.24)] rounded flex items-center justify-between px-2 py-1"
              >
                <div className="flex items-center gap-2">
                  {selectedAgent.logo && (
                    <div className="w-6 h-6 flex items-center justify-center">
                      {selectedAgent.logo}
                    </div>
                  )}
                  <span className="text-gray-900 dark:text-white text-sm font-medium">
                    {selectedAgent.displayName}
                  </span>
                </div>
                <ChevronDown className="w-5 h-5 text-gray-400 dark:text-neutral-400" />
              </button>

              {/* Dropdown Menu */}
              {isDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-40 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded shadow-lg z-50">
                  {MCP_AGENTS.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => {
                        setSelectedAgent(agent);
                        setIsDropdownOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-2 py-2 text-gray-900 dark:text-white text-sm hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors"
                    >
                      {agent.logo && (
                        <div className="w-6 h-6 flex items-center justify-center">{agent.logo}</div>
                      )}
                      <span className="font-medium">{agent.displayName}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Step 1 - Conditional based on agent */}
            {selectedAgent.id === 'cursor' ? (
              <div className="flex flex-col gap-3">
                <p className="text-gray-900 dark:text-white text-sm">
                  <span className="font-semibold leading-5">Step 1</span>
                  <span className="leading-6"> - Install in one click</span>
                </p>
                <div className="w-fit">
                  <CursorDeeplinkGenerator apiKey={displayApiKey} os="macos-linux" />
                </div>
              </div>
            ) : selectedAgent.id === 'mcp' ? (
              <div className="flex flex-col gap-3">
                <p className="text-gray-900 dark:text-white text-sm">
                  <span className="font-semibold leading-5">Step 1</span>
                  <span className="leading-6">
                    {' '}
                    - Copy the configuration below and add it to your AI assistant.
                  </span>
                </p>
                <div className="bg-gray-100 dark:bg-neutral-900 rounded overflow-hidden flex flex-col h-[320px] w-full">
                  {/* Header - fixed at top */}
                  <div className="bg-gray-100 dark:bg-neutral-900 flex items-center justify-between p-3">
                    <div className="bg-gray-200 dark:bg-neutral-700 rounded px-2">
                      <span className="text-gray-700 dark:text-neutral-50 text-xs">
                        MCP Configuration
                      </span>
                    </div>
                    <CopyButton
                      text={mcpJsonConfig}
                      showText={false}
                      className="h-6 w-6 p-1 bg-white dark:bg-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-600 border-none rounded-md shadow-sm min-w-0 text-black dark:text-white"
                    />
                  </div>
                  {/* Scrollable content */}
                  <div className="flex-1 overflow-auto p-3">
                    <pre className="text-gray-700 dark:text-neutral-300 text-sm leading-6 m-0 whitespace-pre-wrap break-all">
                      <code>{mcpJsonConfig}</code>
                    </pre>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-gray-900 dark:text-white text-sm">
                  <span className="font-semibold leading-5">Step 1</span>
                  <span className="leading-6"> - Install in one click</span>
                </p>
                <CodeBlock
                  code={installCommand}
                  label="Terminal Command"
                  className={cn(isLoading && 'animate-pulse')}
                />
              </div>
            )}

            {/* Step 2 */}
            <div className="flex flex-col gap-3">
              <p className="text-gray-900 dark:text-white text-sm">
                <span className="font-semibold leading-5">Step 2</span>
                <span className="leading-6">
                  {' '}
                  - Send the prompt below in your agent&apos;s chat
                </span>
              </p>
              <CodeBlock
                code={testPrompt}
                label="prompt"
                className="bg-gray-100 dark:bg-neutral-900"
              />
            </div>
          </div>

          {/* Help Section */}
          <div className="flex items-end justify-between">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 dark:text-neutral-400 text-sm leading-6">
                  Need help?
                </span>
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
