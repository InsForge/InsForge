import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils/utils';
import { CodeBlock } from '@/components/CodeBlock';
import { Tabs, TabsList, TabsTrigger } from '@/components/radix/Tabs';
import { Alert, AlertDescription } from '@/components/radix/Alert';
import { JsonHighlight } from '@/components/JsonHighlight';
import { CursorDeeplinkGenerator } from './CursorDeeplinkGenerator';
import { MCP_AGENTS, createMCPConfig, type MCPAgent, type PlatformType } from '@/components/mcp/mcp-agents';
import { metadataService } from '@/features/dashboard/services/metadata.service';

interface MCPInstallerProps {
  className?: string;
  defaultAgent?: string;
}

export function MCPInstaller({ className, defaultAgent = 'cursor' }: MCPInstallerProps) {
  const [selectedAgent, setSelectedAgent] = useState<MCPAgent>(() => {
    return MCP_AGENTS.find((agent) => agent.id === defaultAgent) || MCP_AGENTS[0];
  });
  const [activeTab, setActiveTab] = useState<PlatformType>('macos-linux');

  const { data: apiKey } = useQuery({
    queryKey: ['apiKey'],
    queryFn: () => metadataService.fetchApiKey(),
    staleTime: Infinity,
  });

  const handleTabChange = (value: string) => {
    setActiveTab(value as PlatformType);
  };

  const mcpConfig = useMemo(() => {
    return createMCPConfig(apiKey || '', activeTab, import.meta.env.VITE_API_BASE_URL);
  }, [apiKey, activeTab]);

  return (
    <div
      className={cn(
        'w-full border border-border-gray rounded-xl bg-slate-100 overflow-hidden',
        className
      )}
    >
      {/* Agent Tabs */}
      <div className="flex">
        {MCP_AGENTS.map((agent) => (
          <button
            key={agent.id}
            onClick={() => setSelectedAgent(agent)}
            className={cn(
              'w-full px-3 py-2 text-sm font-medium text-zinc-950 transition-all duration-200 border-r border-border-gray last:border-r-0 flex flex-row items-center gap-1',
              selectedAgent.id === agent.id ? 'bg-white' : 'hover:bg-white/50'
            )}
          >
            {agent.logo && <img src={agent.logo} alt={agent.displayName} className="w-6 h-6" />}
            {agent.displayName}
          </button>
        ))}
      </div>

      {/* Content */}
      {selectedAgent.id !== 'mcp' ? (
        <div className="bg-white px-6 py-8 flex flex-col items-start justify-start gap-4">
          {selectedAgent.id === 'cursor' && (
            <CursorDeeplinkGenerator
              apiKey={apiKey}
              apiBaseUrl={import.meta.env.VITE_API_BASE_URL}
              os={activeTab}
            />
          )}

          {/* Alternative Installation */}
          <p className="text-zinc-950 text-sm">
            {selectedAgent.id === 'cursor' ? 'or copy' : 'Copy'} the command below and paste it to
            terminal
          </p>

          {/* Command Block */}
          <CodeBlock
            code={selectedAgent.installCommand || ''}
            className="bg-slate-50 w-full font-normal text-blue-800"
          />
        </div>
      ) : (
        <div className="px-6 py-8 bg-white overflow-hidden">
          <p className="text-zinc-950 text-sm mb-3">
            Copy the configuration below and add it to your AI assistant.
          </p>
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <div className="flex items-center justify-between">
              <TabsList className="grid w-60 grid-cols-2 bg-gray-100 p-1.5 rounded-md h-fit">
                <TabsTrigger
                  value="macos-linux"
                  className="h-7 rounded-sm px-3 py-1 text-sm font-medium transition-all duration-200
                    data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm
                    data-[state=inactive]:text-gray-600 data-[state=inactive]:hover:text-gray-900"
                >
                  MacOS/Linux
                </TabsTrigger>
                <TabsTrigger
                  value="windows"
                  className="h-7 rounded-sm px-3 py-1 text-sm font-medium transition-all duration-200
                    data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm
                    data-[state=inactive]:text-gray-600 data-[state=inactive]:hover:text-gray-900"
                >
                  Windows
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Configuration content */}
            <div className="mt-1">
              {!apiKey && (
                <Alert className="border-yellow-200 bg-yellow-50 mb-4">
                  <AlertDescription className="text-yellow-800">
                    No API key found. Please ensure the backend is running and you&apos;re logged in
                    as an admin.
                  </AlertDescription>
                </Alert>
              )}

              <JsonHighlight json={JSON.stringify(mcpConfig, null, 2)} />
            </div>
          </Tabs>
        </div>
      )}
    </div>
  );
}
