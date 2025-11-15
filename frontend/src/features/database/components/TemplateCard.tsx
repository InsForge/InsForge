import { Table } from 'lucide-react';
import { DatabaseTemplate } from '@/features/database/templates';

interface TemplateCardProps {
  template: DatabaseTemplate;
  onClick: () => void;
  showTableCount?: boolean;
}

export function TemplateCard({ template, onClick, showTableCount = false }: TemplateCardProps) {
  return (
    <button
      onClick={onClick}
      className="bg-white dark:bg-[#363636] border border-gray-200 dark:border-[#414141] rounded-[4px] pl-6 pr-4 pt-4 pb-6 text-left transition-colors hover:bg-gray-50 hover:border-gray-300 dark:hover:bg-neutral-700 dark:hover:border-[#525252] hover:shadow-sm flex flex-col gap-3"
    >
      <div className="flex flex-col gap-2">
        <h3 className="text-base font-normal text-zinc-950 dark:text-white leading-6">
          {template.title}
        </h3>
        {/* Fixed height container for description with line clamp */}
        <div className="h-[72px]">
          <p className="text-sm font-normal text-zinc-500 dark:text-neutral-400 leading-6 line-clamp-3">
            {template.description}
          </p>
        </div>
      </div>
      {showTableCount && (
        <div className="flex items-center gap-2">
          <Table className="w-5 h-5 text-zinc-500 dark:text-neutral-400" />
          <p className="text-sm font-normal text-zinc-500 dark:text-neutral-400 leading-6">
            {template.tableCount} {template.tableCount === 1 ? 'Table' : 'Tables'}
          </p>
        </div>
      )}
    </button>
  );
}
