import { useState, useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  CodeBlock,
  CopyButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components';
import { CursorDeeplinkGenerator } from './mcp/CursorDeeplinkGenerator';
import { QoderDeeplinkGenerator } from './mcp/QoderDeeplinkGenerator';
import { MCP_AGENTS, GenerateInstallCommand, createMCPConfig, type MCPAgent } from './mcp/helpers';
import { cn } from '@/lib/utils/utils';

interface McpConnectionSectionProps {
  apiKey: string;
  appUrl: string;
  isLoading?: boolean;
  className?: string;
  onAgentChange?: (agent: MCPAgent) => void;
}

export function McpConnectionSection({
  apiKey,
  appUrl,
  isLoading = false,
  className,
  onAgentChange,
}: McpConnectionSectionProps) {
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
          <p className="text-gray-900 dark:text-white text-base leading-6 font-medium">
            <span className="text-emerald-500 dark:text-emerald-300">Step1</span>
            <span> Install InsForge</span>
          </p>
          {(selectedAgent.id === 'cursor' || selectedAgent.id === 'qoder') && (
            <p className="text-gray-500 dark:text-neutral-400 text-sm leading-6">
              Install in one click
            </p>
          )}
          {selectedAgent.id === 'mcp' && (
            <p className="text-gray-500 dark:text-neutral-400 text-sm leading-6">
              Add this configuration to your MCP settings
            </p>
          )}
          {selectedAgent.id !== 'cursor' &&
            selectedAgent.id !== 'qoder' &&
            selectedAgent.id !== 'mcp' && (
              <p className="text-gray-500 dark:text-neutral-400 text-sm leading-6">
                Run the following command in terminal to install InsForge MCP Server
              </p>
            )}
        </div>
        <div
          className={`flex-1 flex ${selectedAgent.id === 'cursor' || selectedAgent.id === 'qoder' ? 'flex-row gap-3' : 'flex-col gap-3'}`}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-40 bg-gray-100 dark:bg-[rgba(0,0,0,0.12)] border border-gray-300 dark:border-[rgba(255,255,255,0.24)] rounded flex items-center justify-between px-2 py-1 cursor-pointer">
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
                <ChevronDown className="w-5 h-5 text-gray-500 dark:text-neutral-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-40 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded shadow-lg p-0"
            >
              {MCP_AGENTS.map((agent) => (
                <DropdownMenuItem
                  key={agent.id}
                  onSelect={() => handleAgentChange(agent)}
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

          {selectedAgent.id === 'cursor' ? (
            <div className="w-fit">
              <CursorDeeplinkGenerator apiKey={apiKey} os="macos-linux" />
            </div>
          ) : selectedAgent.id === 'qoder' ? (
            <div className="w-fit">
              <QoderDeeplinkGenerator apiKey={apiKey} os="macos-linux" />
            </div>
          ) : selectedAgent.id === 'mcp' ? (
            <div className="bg-gray-100 dark:bg-neutral-900 rounded overflow-hidden flex flex-col h-[320px] w-full">
              {/* Header - fixed at top */}
              <div className="bg-gray-100 dark:bg-neutral-900 flex items-center justify-between p-3">
                <div className="px-2">
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
          ) : (
            <CodeBlock
              code={installCommand}
              label="Terminal Command"
              className={cn(isLoading && 'animate-pulse')}
            />
          )}
        </div>
      </div>

      {/* Step 2 */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <p className="text-gray-900 dark:text-white text-base leading-6 font-medium">
            <span className="text-emerald-500 dark:text-emerald-300">Step2</span>
            <span> Verify Connection</span>
          </p>
          <p className="text-gray-500 dark:text-neutral-400 text-sm leading-6">
            Send the prompt below to your AI coding agent to verify the connection.
          </p>
        </div>
        <CodeBlock code={testPrompt} label="prompt" className="bg-gray-100 dark:bg-neutral-900 break-normal" />
      </div>
    </div>
  );
}
