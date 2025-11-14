import { Plus } from 'lucide-react';
import { Button } from '@/components/radix/Button';
import { DatabaseTemplate } from '@/features/database/templates';
import { TemplateCard } from './TemplateCard';

interface TablesEmptyStateProps {
  templates: DatabaseTemplate[];
  onCreateTable: () => void;
  onTemplateClick: (template: DatabaseTemplate) => void;
}

export function TablesEmptyState({
  templates,
  onCreateTable,
  onTemplateClick,
}: TablesEmptyStateProps) {
  return (
    <div className="flex justify-center w-full h-full bg-bg-gray dark:bg-neutral-800 px-6">
      <div className="flex flex-col gap-6 max-w-[1024px] w-full pb-9 pt-6">
        <h2 className="text-xl font-semibold text-zinc-950 dark:text-white leading-7 tracking-[-0.1px]">
          Create Your First Table
        </h2>
        <Button
          className="h-9 w-50 gap-2 font-medium dark:bg-emerald-300 dark:hover:bg-emerald-400 dark:text-black"
          onClick={onCreateTable}
        >
          <Plus className="w-5 h-5" />
          Create Table
        </Button>
        <div className="flex flex-col gap-3">
          <p className="text-sm font-normal text-zinc-500 dark:text-neutral-400 leading-6">
            or choose a template to start
          </p>
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-6">
            {templates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onClick={() => onTemplateClick(template)}
                showTableCount
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
