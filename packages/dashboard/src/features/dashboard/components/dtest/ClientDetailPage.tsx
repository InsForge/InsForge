import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@insforge/ui';
import { ConnectionStringSectionV2 } from '#features/dashboard/components/connect/ConnectionStringSectionV2';
import { APIKeysSectionV2 } from '#features/dashboard/components/connect/APIKeysSectionV2';
import { DTestMCPSection } from './DTestMCPSection';
import { DTestCLISection } from './DTestCLISection';
import { QuickStartPromptCard } from './QuickStartPromptCard';
import { CLIENT_ENTRIES, DEFAULT_AGENT_TABS, type AgentTab, type ClientId } from './clientRegistry';
import {
  useApiKey,
  useAnonKey,
  useDatabaseConnectionString,
  useDatabasePassword,
} from '#lib/hooks/useMetadata';
import { cn, getBackendUrl } from '#lib/utils/utils';
import { getFeatureFlag } from '#lib/analytics/posthog';

interface ClientDetailPageProps {
  clientId: ClientId;
  onBack: () => void;
}

export function ClientDetailPage({ clientId, onBack }: ClientDetailPageProps) {
  const entry = CLIENT_ENTRIES[clientId];
  const declaredTabs = entry.tabs ?? DEFAULT_AGENT_TABS;
  const mcpVsCliVariant = getFeatureFlag('mcp-vs-cli');
  const variantAllowed: ReadonlyArray<AgentTab> =
    mcpVsCliVariant === 'mcp' ? ['mcp'] : mcpVsCliVariant === 'cli' ? ['cli'] : declaredTabs;
  const filteredTabs = declaredTabs.filter((t) => variantAllowed.includes(t));
  const availableTabs = filteredTabs.length > 0 ? filteredTabs : declaredTabs;
  const { apiKey, isLoading: isApiKeyLoading } = useApiKey();
  const { anonKey, isLoading: isAnonKeyLoading } = useAnonKey();
  const { connectionData } = useDatabaseConnectionString();
  const { passwordData } = useDatabasePassword();
  const [tab, setTab] = useState<AgentTab>(availableTabs[0] ?? 'cli');
  // Guard against `tab` drifting out of `availableTabs` if the variant filter
  // changes after mount (e.g. PostHog flag resolves late). Click handlers
  // continue to update `tab` directly; this just ensures the rendered tab is
  // always one the user is allowed to see.
  const activeTab: AgentTab = availableTabs.includes(tab) ? tab : (availableTabs[0] ?? 'cli');

  const appUrl = getBackendUrl();
  const displayApiKey = isApiKeyLoading ? 'ik_' + '*'.repeat(32) : apiKey || '';
  // Backend returns the connection URL with its password masked as `********`.
  // Substitute the real password so the prompt the user pastes into their agent
  // actually works. If the password isn't available yet, fall back to the
  // placeholder so we don't paste a broken-looking string either.
  const dbPassword = passwordData?.databasePassword || '';
  const connectionUrl = connectionData?.connectionURL || '';
  const connectionUrlWithPassword = dbPassword
    ? connectionUrl.replace('********', dbPassword)
    : connectionUrl;
  const connectionStringPrompt = `I'm using InsForge as my backend. Here's my database connection string:\n\n${connectionUrlWithPassword || '<connection string>'}\n\nPlease connect to my database.`;

  return (
    <main className="h-full min-h-0 min-w-0 overflow-y-auto bg-semantic-1">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-6 pb-10 pt-10">
        {/* Back */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="w-fit gap-1 px-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
          All Clients
        </Button>

        {/* Title row */}
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 shrink-0">{entry.detailIcon}</div>
          <h1 className="text-[28px] font-medium leading-10 text-foreground">{entry.label}</h1>
        </div>

        {/* Body per kind */}
        {entry.kind === 'agent' ? (
          <>
            {/* CLI/MCP toggle — only shown when the entry supports more than one tab */}
            {availableTabs.length > 1 && (
              <div className="flex w-full overflow-hidden rounded border border-[var(--alpha-8)] bg-[var(--alpha-4)]">
                {availableTabs.map((t) => (
                  <TabButton
                    key={t}
                    active={activeTab === t}
                    onClick={() => setTab(t)}
                    label={t === 'cli' ? 'CLI' : 'MCP'}
                  />
                ))}
              </div>
            )}

            {activeTab === 'cli' ? (
              <DTestCLISection agentName={entry.label} />
            ) : (
              <DTestMCPSection
                apiKey={displayApiKey}
                appUrl={appUrl}
                isLoading={isApiKeyLoading}
                agentId={entry.mcpAgentId}
                hideQuickStartPrompt={clientId === 'other'}
              />
            )}
          </>
        ) : clientId === 'connection-string' ? (
          <div className="flex flex-col gap-3">
            <QuickStartPromptCard
              subtitle="Paste this into your agent to setup Connection String"
              prompt={connectionStringPrompt}
            />
            <div className="rounded border border-[var(--alpha-8)] bg-card p-6">
              <ConnectionStringSectionV2 variant="vertical" />
            </div>
          </div>
        ) : (
          <div className="rounded border border-[var(--alpha-8)] bg-card p-6">
            <APIKeysSectionV2
              apiKey={displayApiKey}
              anonKey={anonKey || ''}
              appUrl={appUrl}
              isLoading={isApiKeyLoading || isAnonKeyLoading}
            />
          </div>
        )}
      </div>
    </main>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
}

function TabButton({ active, onClick, label }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center px-3 py-1.5 text-sm',
        active ? 'bg-toast text-foreground' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
    </button>
  );
}
