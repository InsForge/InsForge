import { useState, useMemo, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  CodeBlock,
  CopyButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components';
import { CursorDeeplinkGenerator } from '../mcp/CursorDeeplinkGenerator';
import { QoderDeeplinkGenerator } from '../mcp/QoderDeeplinkGenerator';
import { MCP_AGENTS, GenerateInstallCommand, createMCPConfig, type MCPAgent } from '../mcp/helpers';
import { cn } from '@/lib/utils/utils';

interface InstallStepProps {
  apiKey: string;
  appUrl: string;
  isLoading?: boolean;
  onAgentChange?: (agent: MCPAgent) => void;
  onTrigerClick?: () => void;
  onCommandCopied?: () => void;
}

export function InstallStep({
  apiKey,
  appUrl,
  isLoading = false,
  onAgentChange,
  onTrigerClick,
  onCommandCopied,
}: InstallStepProps) {
  const [selectedAgent, setSelectedAgent] = useState<MCPAgent>(MCP_AGENTS[0]);

  const handleAgentChange = useCallback(
    (agent: MCPAgent) => {
      setSelectedAgent(agent);
      onAgentChange?.(agent);
    },
    [onAgentChange]
  );

  const installCommand = useMemo(() => {
    return GenerateInstallCommand(selectedAgent, apiKey);
  }, [selectedAgent, apiKey]);

  const mcpJsonConfig = useMemo(() => {
    const config = createMCPConfig(apiKey, 'macos-linux', appUrl);
    return JSON.stringify(config, null, 2);
  }, [apiKey, appUrl]);

  // Description text based on agent type
  const descriptionText = useMemo(() => {
    if (selectedAgent.id === 'cursor' || selectedAgent.id === 'qoder') {
      return 'Install in one click';
    }
    if (selectedAgent.id === 'mcp') {
      return 'Add this configuration to your MCP settings';
    }
    return 'Run the following command in terminal to install InsForge MCP Server';
  }, [selectedAgent.id]);

  return (
    <div className="flex flex-col gap-6">
      <p className="dark:text-neutral-400 text-gray-500 text-sm leading-6">{descriptionText}</p>

      {/* Agent Selector Dropdown */}
      <div className="flex items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-40 bg-gray-100 dark:bg-[rgba(0,0,0,0.12)] border border-gray-300 dark:border-[rgba(255,255,255,0.24)] rounded flex items-center justify-between px-2 py-1 cursor-pointer" onClick={onTrigerClick}>
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

        {/* Install button - Conditional based on agent */}
        {selectedAgent.id === 'cursor' && (
          <CursorDeeplinkGenerator apiKey={apiKey} os="macos-linux" />
        )}
        {selectedAgent.id === 'qoder' && (
          <QoderDeeplinkGenerator apiKey={apiKey} os="macos-linux" />
        )}
      </div>

      {/* Install instructions for non-deeplink agents */}
      {selectedAgent.id === 'mcp' ? (
        <div className="bg-neutral-200 dark:bg-neutral-900 rounded overflow-hidden flex flex-col h-[280px] w-full">
          {/* Header */}
          <div className="bg-neutral-200 dark:bg-neutral-900 flex items-center justify-between p-3">
            <div className="px-2">
              <span className="text-gray-700 dark:text-neutral-50 text-xs">MCP Configuration</span>
            </div>
            <CopyButton
              text={mcpJsonConfig}
              showText={false}
              className="h-6 w-6 p-1 bg-white dark:bg-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-600 border-none rounded-md shadow-sm min-w-0 text-black dark:text-white"
              onCopy={onCommandCopied}
            />
          </div>
          {/* Scrollable content */}
          <div className="flex-1 overflow-auto p-3">
            <pre className="text-gray-700 dark:text-neutral-300 text-sm leading-6 m-0 whitespace-pre-wrap break-all">
              <code>{mcpJsonConfig}</code>
            </pre>
          </div>
        </div>
      ) : selectedAgent.id !== 'cursor' && selectedAgent.id !== 'qoder' ? (
        <CodeBlock
          code={installCommand}
          label="Terminal Command"
          className={cn(isLoading && 'animate-pulse', 'bg-neutral-200 dark:bg-neutral-900')}
          onCopy={onCommandCopied}
        />
      ) : null}
    </div>
  );
}
