import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ClientTile } from './ClientTile';
import { DTestInstallCliSection } from './DTestInstallCliSection';
import {
  CLIENT_ENTRIES,
  CLIENT_LABEL_I18N_KEYS,
  CODING_AGENT_GRID_IDS,
  DEFAULT_AGENT_TABS,
  DIRECT_CONNECT_IDS,
  type ClientId,
} from './clientRegistry';
import { getFeatureFlag } from '#lib/analytics/posthog';
import { FEATURE_FLAGS } from '#lib/analytics/constants';

interface InstallInsForgePageProps {
  onSelectClient: (id: ClientId) => void;
  onDismiss: () => void;
}

export function InstallInsForgePage({ onSelectClient, onDismiss }: InstallInsForgePageProps) {
  const { t } = useTranslation('chrome');
  const mcpVsCliVariant = getFeatureFlag(FEATURE_FLAGS.MCP_VS_CLI);
  const gridEntries = CODING_AGENT_GRID_IDS.map((id) => CLIENT_ENTRIES[id]).filter((entry) => {
    const tabs = entry.tabs ?? DEFAULT_AGENT_TABS;
    if (mcpVsCliVariant === 'mcp') {
      return tabs.includes('mcp');
    }
    if (mcpVsCliVariant === 'cli') {
      return tabs.includes('cli');
    }
    return true;
  });
  const directEntries = DIRECT_CONNECT_IDS.map((id) => CLIENT_ENTRIES[id]);
  const showCliPrompt = mcpVsCliVariant !== 'mcp';

  return (
    <main className="h-full min-h-0 min-w-0 overflow-y-auto bg-semantic-1">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-6 pb-10 pt-16">
        {/* Title row */}
        <div className="flex items-center justify-between">
          <h1 className="text-[28px] font-medium leading-10 text-foreground">
            {t('overview.installInsForge', { defaultValue: 'Install InsForge' })}
          </h1>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t('overview.closeInstallPage', { defaultValue: 'Close install page' })}
            className="flex h-8 w-8 items-center justify-center rounded border border-[var(--alpha-8)] bg-card text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Section 1: Use InsForge with CLI — hidden for mcp-vs-cli=mcp */}
        {showCliPrompt && <DTestInstallCliSection />}

        {/* Section 2: Install in Agent */}
        <section className="flex flex-col gap-3 rounded border border-[var(--alpha-8)] bg-card p-6">
          <h2 className="text-base font-medium leading-7 text-foreground">
            {t('overview.installInAgent', { defaultValue: 'Install in Agent' })}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {gridEntries.map((entry) => (
              <ClientTile
                key={entry.id}
                icon={entry.icon}
                label={
                  CLIENT_LABEL_I18N_KEYS[entry.id]
                    ? t(CLIENT_LABEL_I18N_KEYS[entry.id] as string, { defaultValue: entry.label })
                    : entry.label
                }
                onClick={() => onSelectClient(entry.id)}
              />
            ))}
          </div>
        </section>

        {/* Section 3: Direct Connect */}
        <section className="flex flex-col gap-3 rounded border border-[var(--alpha-8)] bg-card p-6">
          <h2 className="text-base font-medium leading-7 text-foreground">
            {t('overview.directConnect', { defaultValue: 'Direct Connect' })}
          </h2>
          <div className="flex gap-3">
            {directEntries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onSelectClient(entry.id)}
                className="flex flex-1 flex-col items-center justify-center gap-3 rounded border border-alpha-8 bg-toast py-6 transition-colors hover:bg-alpha-12"
              >
                <div className="flex h-6 w-6 items-center justify-center">{entry.icon}</div>
                <span className="text-[13px] leading-[18px] text-foreground">
                  {CLIENT_LABEL_I18N_KEYS[entry.id]
                    ? t(CLIENT_LABEL_I18N_KEYS[entry.id] as string, { defaultValue: entry.label })
                    : entry.label}
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
