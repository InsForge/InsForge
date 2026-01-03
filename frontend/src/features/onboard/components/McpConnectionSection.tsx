import { useState, useMemo } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';
import {
  CodeBlock,
  CopyButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components';
import { VideoDemoModal } from './VideoDemoModal';
import { CursorDeeplinkGenerator } from './mcp/CursorDeeplinkGenerator';
import { MCP_AGENTS, GenerateInstallCommand, createMCPConfig, type MCPAgent } from './mcp/helpers';
import { cn } from '@/lib/utils/utils';

interface McpConnectionSectionProps {
  apiKey: string;
  appUrl: string;
  isLoading?: boolean;
  className?: string;
}

export function McpConnectionSection({
  apiKey,
  appUrl,
  isLoading = false,
  className,
}: McpConnectionSectionProps) {
  const [selectedAgent, setSelectedAgent] = useState<MCPAgent>(MCP_AGENTS[0]);
  const [isVideoTooltipOpen, setIsVideoTooltipOpen] = useState(false);

  const installCommand = useMemo(() => {
    return GenerateInstallCommand(selectedAgent, apiKey);
  }, [selectedAgent, apiKey]);

  const mcpJsonConfig = useMemo(() => {
    const config = createMCPConfig(apiKey, 'macos-linux', appUrl);
    return JSON.stringify(config, null, 2);
  }, [apiKey, appUrl]);

  const testPrompt =
    "I'm using InsForge as my backend platform, call InsForge MCP's fetch-docs tool to learn about InsForge instructions.";

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <p className="text-gray-500 dark:text-neutral-400 text-base leading-7">
        Install the MCP server so your coding agent can access and build the backend.
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              onMouseEnter={() => setIsVideoTooltipOpen(true)}
              onMouseLeave={() => setIsVideoTooltipOpen(false)}
              className="inline-flex items-center align-middle ml-2 cursor-help"
            >
              <HelpCircle className="w-5 h-5 text-gray-400 dark:text-neutral-400 shrink-0" />
            </span>
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
      </p>

      {/* Agent Selector Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="w-40 bg-gray-100 dark:bg-[rgba(0,0,0,0.12)] border border-gray-300 dark:border-[rgba(255,255,255,0.24)] rounded flex items-center justify-between px-2 py-1 cursor-pointer">
            <div className="flex items-center gap-2">
              {selectedAgent.logo && (
                <div className="w-6 h-6 flex items-center justify-center">{selectedAgent.logo}</div>
              )}
              <span className="text-gray-900 dark:text-white text-sm font-medium">
                {selectedAgent.displayName}
              </span>
            </div>
            <ChevronDown className="w-5 h-5 text-gray-400 dark:text-neutral-400" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-40 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded shadow-lg p-0"
        >
          {MCP_AGENTS.map((agent) => (
            <DropdownMenuItem
              key={agent.id}
              onSelect={() => setSelectedAgent(agent)}
              className="flex items-center gap-2 px-2 py-2 text-gray-900 dark:text-white text-sm hover:bg-gray-100 dark:hover:bg-neutral-700 cursor-pointer"
            >
              {agent.logo && (
                <div className="w-6 h-6 flex items-center justify-center">{agent.logo}</div>
              )}
              <span className="font-medium">{agent.displayName}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Step 1 - Conditional based on agent */}
      {selectedAgent.id === 'cursor' ? (
        <div className="flex flex-col gap-3">
          <p className="text-gray-900 dark:text-white text-sm">
            <span className="font-semibold leading-5">1.</span>
            <span className="leading-6"> Install in one click</span>
          </p>
          <div className="w-fit">
            <CursorDeeplinkGenerator apiKey={apiKey} os="macos-linux" />
          </div>
        </div>
      ) : selectedAgent.id === 'mcp' ? (
        <div className="flex flex-col gap-3">
          <p className="text-gray-900 dark:text-white text-sm">
            <span className="font-semibold leading-5">1.</span>
            <span className="leading-6">
              {' '}
              Copy the configuration below and add it to your AI assistant.
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
            <span className="font-semibold leading-5">1.</span>
            <span className="leading-6"> Install in one click</span>
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
          <span className="font-semibold leading-5">2.</span>
          <span className="leading-6"> Check for connection using this prompt</span>
        </p>
        <CodeBlock code={testPrompt} label="prompt" className="bg-gray-100 dark:bg-neutral-900" />
      </div>
    </div>
  );
}
