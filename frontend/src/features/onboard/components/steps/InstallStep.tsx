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
import { CursorDeeplinkGenerator } from '../mcp/CursorDeeplinkGenerator';
import { QoderDeeplinkGenerator } from '../mcp/QoderDeeplinkGenerator';
import { MCP_AGENTS, GenerateInstallCommand, createMCPConfig, type MCPAgent } from '../mcp/helpers';
import { cn } from '@/lib/utils/utils';

interface InstallStepProps {
  apiKey: string;
  appUrl: string;
  isLoading?: boolean;
  onAgentChange?: (agent: MCPAgent) => void;
}

export function InstallStep({
  apiKey,
  appUrl,
  isLoading = false,
  onAgentChange,
}: InstallStepProps) {
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
      <p className="text-neutral-400 text-sm leading-6">{descriptionText}</p>

      {/* Agent Selector Dropdown */}
      <div className="flex items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-40 bg-[rgba(0,0,0,0.12)] border border-[rgba(255,255,255,0.24)] rounded flex items-center justify-between px-2 py-1 cursor-pointer">
              <div className="flex items-center gap-2">
                {selectedAgent.logo && (
                  <div className="w-6 h-6 flex items-center justify-center">
                    {selectedAgent.logo}
                  </div>
                )}
                <span className="text-white text-sm font-medium">{selectedAgent.displayName}</span>
              </div>
              <ChevronDown className="w-5 h-5 text-neutral-400" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-40 bg-neutral-800 border border-neutral-700 rounded shadow-lg p-0"
          >
            {MCP_AGENTS.map((agent) => (
              <DropdownMenuItem
                key={agent.id}
                onSelect={() => handleAgentChange(agent)}
                className="flex items-center gap-2 px-2 py-2 text-white text-sm hover:bg-neutral-700 cursor-pointer"
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
        <div className="bg-neutral-900 rounded overflow-hidden flex flex-col h-[280px] w-full">
          {/* Header */}
          <div className="bg-neutral-900 flex items-center justify-between p-3">
            <div className="bg-neutral-700 rounded px-2">
              <span className="text-neutral-50 text-xs">MCP Configuration</span>
            </div>
            <CopyButton
              text={mcpJsonConfig}
              showText={false}
              className="h-6 w-6 p-1 bg-neutral-700 hover:bg-neutral-600 border-none rounded-md shadow-sm min-w-0 text-white"
            />
          </div>
          {/* Scrollable content */}
          <div className="flex-1 overflow-auto p-3">
            <pre className="text-neutral-300 text-sm leading-6 m-0 whitespace-pre-wrap break-all">
              <code>{mcpJsonConfig}</code>
            </pre>
          </div>
        </div>
      ) : selectedAgent.id !== 'cursor' && selectedAgent.id !== 'qoder' ? (
        <CodeBlock
          code={installCommand}
          label="Terminal Command"
          className={cn(isLoading && 'animate-pulse', 'bg-neutral-900')}
        />
      ) : null}
    </div>
  );
}
