import { useState, useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  CodeBlock,
  CopyButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@insforge/ui';
import { CursorDeeplinkGenerator } from './mcp/CursorDeeplinkGenerator';
import { QoderDeeplinkGenerator } from './mcp/QoderDeeplinkGenerator';
import { MCP_AGENTS, GenerateInstallCommand, createMCPConfig, type MCPAgent } from './mcp/helpers';
import { cn } from '@/lib/utils/utils';

interface MCPSectionProps {
  apiKey: string;
  appUrl: string;
  isLoading?: boolean;
  className?: string;
  onAgentChange?: (agent: MCPAgent) => void;
}

export function MCPSection({
  apiKey,
  appUrl,
  isLoading = false,
  className,
  onAgentChange,
}: MCPSectionProps) {
  const [selectedAgent, setSelectedAgent] = useState<MCPAgent>(MCP_AGENTS[0]);

  const handleAgentChange = (agent: MCPAgent) => {
    setSelectedAgent(agent);
    onAgentChange?.(agent);
  };

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
    <div className={cn('flex flex-col gap-10', className)}>
      {/* <p className="text-gray-500 dark:text-neutral-400 text-base leading-7">
        Install the MCP server so your coding agent can access and build the backend.
      </p> */}

      {/* Step 1 */}
      <div className="flex flex-col items-start gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-base leading-6 text-foreground">
            <span>Step 1 - Install InsForge</span>
          </p>
          {(selectedAgent.id === 'cursor' || selectedAgent.id === 'qoder') && (
            <p className="text-sm leading-6 text-muted-foreground">
              Install in one click
            </p>
          )}
          {selectedAgent.id === 'mcp' && (
            <p className="text-sm leading-6 text-muted-foreground">
              Add this configuration to your MCP settings
            </p>
          )}
          {selectedAgent.id !== 'cursor' &&
            selectedAgent.id !== 'qoder' &&
            selectedAgent.id !== 'mcp' && (
              <p className="text-sm leading-6 text-muted-foreground">
                Run the following command in terminal to install InsForge MCP Server
              </p>
            )}
        </div>
        <div
          className={`flex-1 flex ${selectedAgent.id === 'cursor' || selectedAgent.id === 'qoder' ? 'flex-row gap-3' : 'flex-col gap-3'}`}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-40 cursor-pointer items-center justify-between rounded border border-[var(--alpha-8)] bg-semantic-0 px-2 py-1 transition-colors hover:bg-[var(--alpha-4)]">
                <div className="flex items-center gap-2">
                  {selectedAgent.logo && (
                    <div className="w-6 h-6 flex items-center justify-center">
                      {selectedAgent.logo}
                    </div>
                  )}
                  <span className="text-sm font-medium text-foreground">
                    {selectedAgent.displayName}
                  </span>
                </div>
                <ChevronDown className="h-5 w-5 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40 p-0">
              {MCP_AGENTS.map((agent) => (
                <DropdownMenuItem
                  key={agent.id}
                  onSelect={() => handleAgentChange(agent)}
                  className="gap-2 cursor-pointer"
                >
                  {agent.logo && (
                    <div className="w-6 h-6 flex items-center justify-center">{agent.logo}</div>
                  )}
                  <span className="font-medium">{agent.displayName}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {selectedAgent.id === 'cursor' ? (
            <div className="w-fit">
              <CursorDeeplinkGenerator apiKey={apiKey} os="macos-linux" />
            </div>
          ) : selectedAgent.id === 'qoder' ? (
            <div className="w-fit">
              <QoderDeeplinkGenerator apiKey={apiKey} os="macos-linux" />
            </div>
          ) : selectedAgent.id === 'mcp' ? (
            <div className="flex h-[320px] w-full flex-col overflow-hidden rounded border border-[var(--alpha-8)] bg-semantic-0">
              {/* Header - fixed at top */}
              <div className="flex items-center justify-between border-b border-[var(--alpha-8)] bg-semantic-0 p-3">
                <div className="px-2">
                  <span className="text-xs text-muted-foreground">MCP Configuration</span>
                </div>
                <CopyButton text={mcpJsonConfig} showText={false} className="shrink-0" />
              </div>
              {/* Scrollable content */}
              <div className="flex-1 overflow-auto p-3">
                <pre className="m-0 whitespace-pre-wrap break-all text-sm leading-6 text-foreground">
                  <code>{mcpJsonConfig}</code>
                </pre>
              </div>
            </div>
          ) : (
            <CodeBlock
              code={installCommand}
              label="Terminal Command"
              className={cn('bg-semantic-0', isLoading && 'animate-pulse')}
            />
          )}
        </div>
      </div>

      {/* Step 2 */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <p className="text-base leading-6 text-foreground">
            <span>Step 2 - Verify Connection</span>
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            Send the prompt below to your AI coding agent to verify the connection.
          </p>
        </div>
        <CodeBlock code={testPrompt} label="prompt" className="bg-semantic-0" />
      </div>
    </div>
  );
}
