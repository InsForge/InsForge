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
import { MCP_VERIFY_CONNECTION_PROMPT } from './constants';
import { cn } from '#lib/utils/utils';

interface MCPSectionV2Props {
  apiKey: string;
  appUrl: string;
  isLoading?: boolean;
  className?: string;
  onAgentChange?: (agent: MCPAgent) => void;
}

export function MCPSectionV2({
  apiKey,
  appUrl,
  isLoading = false,
  className,
  onAgentChange,
}: MCPSectionV2Props) {
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

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {/* Step 1 - Install InsForge */}
      <div className="flex gap-6">
        <div className="flex w-[240px] shrink-0 gap-2">
          <div className="flex flex-col items-center gap-2 pt-0.5">
            <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--alpha-8)]">
              <span className="text-xs font-medium leading-4 text-foreground">1</span>
            </div>
            <div className="w-px flex-1 bg-[var(--alpha-8)]" />
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <p className="text-sm font-medium leading-6 text-foreground">Install InsForge</p>
            <p className="text-sm leading-6 text-muted-foreground">
              {(selectedAgent.id === 'cursor' || selectedAgent.id === 'qoder') &&
                'Install in one click'}
              {selectedAgent.id === 'mcp' && 'Add this configuration to your MCP settings'}
              {selectedAgent.id !== 'cursor' &&
                selectedAgent.id !== 'qoder' &&
                selectedAgent.id !== 'mcp' &&
                'Run the following command in terminal to install InsForge MCP Server'}
            </p>
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-3">
          <div
            className={cn(
              'flex w-full',
              selectedAgent.id === 'cursor' || selectedAgent.id === 'qoder'
                ? 'items-start gap-3'
                : 'flex-col gap-3'
            )}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex w-40 cursor-pointer items-center justify-between rounded border border-[var(--alpha-8)] bg-semantic-0 px-2 py-1 transition-colors hover:bg-[var(--alpha-4)]">
                  <div className="flex items-center gap-2">
                    {selectedAgent.logo && (
                      <div className="flex h-6 w-6 items-center justify-center">
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
                    className="cursor-pointer gap-2"
                  >
                    {agent.logo && (
                      <div className="flex h-6 w-6 items-center justify-center">{agent.logo}</div>
                    )}
                    <span className="font-medium">{agent.displayName}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {selectedAgent.id === 'cursor' ? (
              <div className="w-fit">
                <CursorDeeplinkGenerator apiKey={isLoading ? '' : apiKey} os="macos-linux" />
              </div>
            ) : selectedAgent.id === 'qoder' ? (
              <div className="w-fit">
                <QoderDeeplinkGenerator apiKey={isLoading ? '' : apiKey} os="macos-linux" />
              </div>
            ) : selectedAgent.id === 'mcp' ? (
              <div className="flex h-[320px] w-full flex-col overflow-hidden rounded border border-[var(--alpha-8)] bg-semantic-0">
                <div className="flex items-center justify-between border-b border-[var(--alpha-8)] bg-semantic-0 p-3">
                  <div className="px-2">
                    <span className="text-xs text-muted-foreground">MCP Configuration</span>
                  </div>
                  <CopyButton
                    text={mcpJsonConfig}
                    showText={false}
                    className="shrink-0"
                    disabled={isLoading}
                  />
                </div>
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
      </div>

      {/* Step 2 - Verify Connection */}
      <div className="flex gap-6">
        <div className="flex w-[240px] shrink-0 gap-2">
          <div className="flex flex-col items-center gap-2 pt-0.5">
            <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--alpha-8)]">
              <span className="text-xs font-medium leading-4 text-foreground">2</span>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <p className="text-sm font-medium leading-6 text-foreground">Verify Connection</p>
            <p className="text-sm leading-6 text-muted-foreground">
              Send the prompt below to your AI coding agent to verify the connection.
            </p>
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-2 rounded border border-[var(--alpha-8)] bg-semantic-0 p-3">
          <div className="flex items-center justify-between">
            <div className="flex h-5 items-center rounded bg-[var(--alpha-8)] px-2">
              <span className="text-xs font-medium leading-4 text-muted-foreground">prompt</span>
            </div>
            <CopyButton text={MCP_VERIFY_CONNECTION_PROMPT} showText={false} className="shrink-0" />
          </div>
          <p className="font-mono text-sm leading-6 text-foreground">
            {MCP_VERIFY_CONNECTION_PROMPT}
          </p>
        </div>
      </div>
    </div>
  );
}
