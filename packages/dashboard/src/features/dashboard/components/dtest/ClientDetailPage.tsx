import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@insforge/ui';
import { ConnectionStringSectionV2 } from '../connect/ConnectionStringSectionV2';
import { APIKeysSectionV2 } from '../connect/APIKeysSectionV2';
import { DTestMCPSection } from './DTestMCPSection';
import { DTestCLISection } from './DTestCLISection';
import { QuickStartPromptCard } from './QuickStartPromptCard';
import { CLIENT_ENTRIES, type AgentTab, type ClientId } from './clientRegistry';
import {
  useApiKey,
  useDatabaseConnectionString,
  useDatabasePassword,
} from '../../../../lib/hooks/useMetadata';
import { useAnonToken } from '../../../auth/hooks/useAnonToken';
import { cn, getBackendUrl } from '../../../../lib/utils/utils';

interface ClientDetailPageProps {
  clientId: ClientId;
  onBack: () => void;
}

const DEFAULT_AGENT_TABS: ReadonlyArray<AgentTab> = ['cli', 'mcp'];

export function ClientDetailPage({ clientId, onBack }: ClientDetailPageProps) {
  const entry = CLIENT_ENTRIES[clientId];
  const availableTabs = entry.tabs ?? DEFAULT_AGENT_TABS;
  const { apiKey, isLoading: isApiKeyLoading } = useApiKey();
  const { accessToken: anonKey, isLoading: isAnonKeyLoading } = useAnonToken();
  const { connectionData } = useDatabaseConnectionString();
  const { passwordData } = useDatabasePassword();
  const [tab, setTab] = useState<AgentTab>(availableTabs[0] ?? 'cli');

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
                    active={tab === t}
                    onClick={() => setTab(t)}
                    label={t === 'cli' ? 'CLI' : 'MCP'}
                  />
                ))}
              </div>
            )}

            {tab === 'cli' ? (
              <DTestCLISection agentName={entry.label} />
            ) : (
              <DTestMCPSection
                apiKey={displayApiKey}
                appUrl={appUrl}
                isLoading={isApiKeyLoading}
                agentId={entry.mcpAgentId}
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
