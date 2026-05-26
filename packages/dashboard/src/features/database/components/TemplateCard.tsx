import { Table2 } from 'lucide-react';
import { DatabaseTemplate } from '#features/database/templates';

interface TemplateCardProps {
  template: DatabaseTemplate;
  onClick: () => void;
  showTableCount?: boolean;
}

export function TemplateCard({ template, onClick, showTableCount = false }: TemplateCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full overflow-hidden rounded border border-[var(--alpha-8)] bg-card text-left transition-colors"
    >
      <div className="flex w-full flex-col gap-3 rounded px-4 pb-6 pt-4 transition-colors group-hover:bg-[var(--alpha-4)] group-active:bg-[var(--alpha-8)]">
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-medium leading-7 text-foreground">{template.title}</h3>
          <p className="min-h-[72px] line-clamp-3 text-sm leading-6 text-muted-foreground">
            {template.description}
          </p>
        </div>
        {showTableCount && (
          <div className="inline-flex w-fit items-center rounded bg-[var(--alpha-8)] px-1 py-0.5">
            <Table2 className="h-4 w-4 text-muted-foreground" />
            <p className="px-1 text-xs font-medium leading-4 text-muted-foreground">
              {template.tableCount} {template.tableCount === 1 ? 'Table' : 'Tables'}
            </p>
          </div>
        )}
      </div>
    </button>
  );
}
