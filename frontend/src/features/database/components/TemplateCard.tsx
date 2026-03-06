import { Table2 } from 'lucide-react';
import { DatabaseTemplate } from '@/features/database/templates';

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
      className="group w-full overflow-hidden rounded-lg border border-[var(--alpha-8)] bg-card text-left transition-colors hover:border-[var(--alpha-16)]"
    >
      <div className="flex w-full flex-col gap-3 p-5 transition-colors group-hover:bg-[var(--alpha-4)] group-active:bg-[var(--alpha-8)]">
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-medium leading-7 text-foreground">{template.title}</h3>
          <p className="min-h-[72px] line-clamp-3 text-sm leading-6 text-muted-foreground">
            {template.description}
          </p>
        </div>
        {showTableCount && (
          <div className="inline-flex w-fit items-center gap-1 rounded-md border border-[var(--alpha-8)] px-2 py-1">
            <Table2 className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs font-medium leading-4 text-muted-foreground">
              {template.tableCount} {template.tableCount === 1 ? 'Table' : 'Tables'}
            </p>
          </div>
        )}
      </div>
    </button>
  );
}
