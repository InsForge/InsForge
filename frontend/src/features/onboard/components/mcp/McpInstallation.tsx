import { useState, useMemo } from 'react';
import { cn, getBackendUrl } from '@/lib/utils/utils';
import { CodeBlock } from '@/components/CodeBlock';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/radix/Tabs';
import { Alert, AlertDescription } from '@/components/radix/Alert';
import { JsonHighlight } from '@/components/JsonHighlight';
import { CursorDeeplinkGenerator } from './CursorDeeplinkGenerator';
import {
  MCP_AGENTS,
  createMCPConfig,
  GenerateInstallCommand,
  type MCPAgent,
  type PlatformType,
} from './helpers';
import { useApiKey } from '@/lib/hooks/useMetadata';

interface McpInstallerProps {
  className?: string;
  defaultAgent?: string;
  TabListClassName?: string;
}

export function McpInstallation({
  className,
  defaultAgent = 'cursor',
  TabListClassName,
}: McpInstallerProps) {
  const [selectedAgent, setSelectedAgent] = useState<MCPAgent>(() => {
    return MCP_AGENTS.find((agent) => agent.id === defaultAgent) || MCP_AGENTS[0];
  });
  const [activeTab, setActiveTab] = useState<PlatformType>('macos-linux');

  const { apiKey } = useApiKey();

  const handleTabChange = (value: string) => {
    setActiveTab(value as PlatformType);
  };

  const mcpConfig = useMemo(() => {
    return createMCPConfig(apiKey || '', activeTab, getBackendUrl());
  }, [apiKey, activeTab]);

  return (
    <div className={cn('w-full flex flex-col gap-2 overflow-hidden', className)}>
      {/* Agent Tabs */}
      <Tabs
        value={selectedAgent.id}
        onValueChange={(value) => {
          const agent = MCP_AGENTS.find((a) => a.id === value);
          if (agent) {
            setSelectedAgent(agent);
          }
        }}
      >
        <TabsList
          className={cn(
            'grid w-full grid-cols-7 bg-neutral-200 dark:bg-[#333333] p-1 rounded-[8px] h-fit mb-2',
            TabListClassName
          )}
        >
          {MCP_AGENTS.map((agent) => (
            <TabsTrigger
              key={agent.id}
              value={agent.id}
              className="rounded-sm px-4 py-2 text-sm font-medium transition-all duration-200 flex flex-row items-center justify-center gap-1
                data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-700 dark:data-[state=active]:text-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm
                data-[state=inactive]:text-gray-600 dark:data-[state=inactive]:text-neutral-400 hover:data-[state=inactive]:text-gray-900 dark:hover:data-[state=inactive]:text-white"
            >
              {agent.logo && (
                <div className="flex items-center justify-center w-6 h-6">{agent.logo}</div>
              )}
              {agent.displayName}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Content for each agent */}
        {MCP_AGENTS.map((agent) => (
          <TabsContent key={agent.id} value={agent.id} className="mt-0">
            {agent.id !== 'mcp' ? (
              <div className="bg-white dark:bg-[#333333] p-6 flex flex-col items-start justify-start gap-4 rounded-[8px] border border-border-gray dark:border-[#333333]">
                {agent.id === 'cursor' && (
                  <CursorDeeplinkGenerator apiKey={apiKey} os={activeTab} />
                )}
                {/* Alternative Installation */}
                <p className="text-zinc-950 dark:text-neutral-300 text-sm">
                  {agent.id === 'cursor' ? 'or copy' : 'Copy'} the command below and paste it to
                  terminal
                </p>
                {/* Command Block */}
                <CodeBlock
                  code={GenerateInstallCommand(agent, apiKey || '')}
                  className="bg-slate-50 dark:bg-neutral-700 w-full font-normal text-blue-800 dark:text-white"
                  buttonClassName="dark:bg-neutral-800 dark:hover:bg-neutral-800 dark:data-[copied=true]:bg-transparent dark:data-[copied=true]:hover:bg-transparent pl-2"
                />
              </div>
            ) : (
              <div className="p-6 bg-white dark:bg-[#333333] overflow-hidden rounded-[8px] border border-border-gray dark:border-[#333333]">
                <p className="text-zinc-950 dark:text-white text-sm mb-3">
                  Copy the configuration below and add it to your AI assistant.
                </p>

                {/* OS Tabs */}
                <div className="flex items-center justify-between">
                  <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                    <TabsList className="grid w-69 grid-cols-2 bg-gray-100 dark:bg-[#404040] p-1 rounded-[8px] h-12">
                      <TabsTrigger
                        value="macos-linux"
                        className="h-9 rounded-sm px-4 py-2 text-sm font-medium transition-all duration-200 flex flex-row items-center justify-center gap-1
                        data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-600 dark:data-[state=active]:text-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm
                        data-[state=inactive]:text-gray-600 dark:data-[state=inactive]:text-white hover:data-[state=inactive]:text-gray-900"
                      >
                        MacOS/Linux
                      </TabsTrigger>
                      <TabsTrigger
                        value="windows"
                        className="h-9 rounded-sm px-4 py-2 text-sm font-medium transition-all duration-200 flex flex-row items-center justify-center gap-1
                        data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-600 dark:data-[state=active]:text-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm
                        data-[state=inactive]:text-gray-600 dark:data-[state=inactive]:text-white hover:data-[state=inactive]:text-gray-900"
                      >
                        Windows
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                {/* Configuration content */}
                <div className="mt-4">
                  {!apiKey && (
                    <Alert className="border-yellow-200 bg-yellow-50 mb-4">
                      <AlertDescription className="text-yellow-800">
                        No API key found. Please ensure the backend is running and you&apos;re
                        logged in as an admin.
                      </AlertDescription>
                    </Alert>
                  )}

                  <JsonHighlight
                    json={JSON.stringify(mcpConfig, null, 2)}
                    textColor="dark:text-white"
                    className="dark:bg-neutral-700"
                  />
                </div>
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
