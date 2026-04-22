import { X } from 'lucide-react';
import { ClientTile } from './ClientTile';
import {
  CLIENT_ENTRIES,
  CODING_AGENT_GRID_IDS,
  DIRECT_CONNECT_IDS,
  FEATURED_OPENCLAW_ID,
  type ClientId,
} from './clientRegistry';

interface InstallInsForgePageProps {
  onSelectClient: (id: ClientId) => void;
  onDismiss: () => void;
}

export function InstallInsForgePage({ onSelectClient, onDismiss }: InstallInsForgePageProps) {
  const featured = CLIENT_ENTRIES[FEATURED_OPENCLAW_ID];
  const gridEntries = CODING_AGENT_GRID_IDS.map((id) => CLIENT_ENTRIES[id]);
  const directEntries = DIRECT_CONNECT_IDS.map((id) => CLIENT_ENTRIES[id]);

  return (
    <main className="h-full min-h-0 min-w-0 overflow-y-auto bg-semantic-1">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-6 pb-10 pt-16">
        {/* Title row */}
        <div className="flex items-center justify-between">
          <h1 className="text-[28px] font-medium leading-10 text-foreground">Install InsForge</h1>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close install page"
            className="flex h-8 w-8 items-center justify-center rounded border border-[var(--alpha-8)] bg-card text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Section 1: Setup in OpenClaw */}
        <section className="flex flex-col gap-3 rounded border border-[var(--alpha-8)] bg-card p-6">
          <h2 className="text-base font-medium leading-7 text-foreground">Setup In OpenClaw</h2>
          {/* 2-column grid with one tile → tile renders at half width, matching Figma. */}
          <div className="grid grid-cols-2 gap-3">
            <ClientTile
              icon={featured.icon}
              label={featured.label}
              onClick={() => onSelectClient(featured.id)}
            />
          </div>
        </section>

        {/* Section 2: Install in Coding Agent */}
        <section className="flex flex-col gap-3 rounded border border-[var(--alpha-8)] bg-card p-6">
          <h2 className="text-base font-medium leading-7 text-foreground">
            Install in Coding Agent
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {gridEntries.map((entry) => (
              <ClientTile
                key={entry.id}
                icon={entry.icon}
                label={entry.label}
                onClick={() => onSelectClient(entry.id)}
              />
            ))}
          </div>
        </section>

        {/* Section 3: Direct Connect */}
        <section className="flex flex-col gap-3 rounded border border-[var(--alpha-8)] bg-card p-6">
          <h2 className="text-base font-medium leading-7 text-foreground">Direct Connect</h2>
          <div className="flex gap-3">
            {directEntries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onSelectClient(entry.id)}
                className="flex flex-1 flex-col items-center justify-center gap-3 rounded border border-alpha-8 bg-toast py-6 transition-colors hover:bg-alpha-12"
              >
                <div className="flex h-6 w-6 items-center justify-center">{entry.icon}</div>
                <span className="text-[13px] leading-[18px] text-foreground">{entry.label}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
