import { type ReactNode } from 'react';

interface ClientTileProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

export function ClientTile({ icon, label, onClick }: ClientTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-w-0 flex-1 items-center gap-3 rounded border border-alpha-8 bg-toast p-3 text-left transition-colors hover:bg-alpha-12"
    >
      <div className="shrink-0">{icon}</div>
      <span className="min-w-0 flex-1 text-sm leading-5 text-foreground">{label}</span>
      <span className="shrink-0 rounded border border-[var(--alpha-8)] bg-card px-2 py-1 text-sm font-medium text-foreground group-hover:bg-[var(--alpha-4)]">
        Install
      </span>
    </button>
  );
}
