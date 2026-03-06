import { Plus } from 'lucide-react';
import { Button } from '@insforge/ui';
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
    <div className="flex h-full w-full justify-center overflow-y-auto bg-[rgb(var(--semantic-1))]">
      <div className="mx-auto flex w-full max-w-[1024px] flex-col gap-6 px-4 pb-10 pt-8 sm:px-6 sm:pt-10 lg:px-10">
        <h2 className="text-2xl font-medium leading-8 text-foreground">Create Your First Table</h2>
        <Button className="h-8 w-fit gap-0 rounded px-1.5" onClick={onCreateTable}>
          <Plus className="h-5 w-5" />
          <span className="px-1 text-sm font-medium leading-5">Create Table</span>
        </Button>
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-6 text-muted-foreground">or choose a template to start</p>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
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
