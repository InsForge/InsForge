import { useNavigate } from 'react-router-dom';
import { DATABASE_TEMPLATES, type DatabaseTemplate } from '@/features/database/templates';
import { useSQLEditorContext } from '@/features/database/contexts/SQLEditorContext';
import { TemplateCard } from '@/features/database/components/TemplateCard';
import { DatabaseStudioMenuPanel } from '@/features/database/components/DatabaseSecondaryMenu';

export default function TemplatesPage() {
  const navigate = useNavigate();
  const { addTab } = useSQLEditorContext();

  const handleTemplateClick = (template: DatabaseTemplate) => {
    // Create a new tab with the template's SQL query prefilled
    addTab(template.sql, template.title);
    // Navigate to the SQL Editor page
    void navigate('/dashboard/sql-editor');
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <DatabaseStudioMenuPanel
        onBack={() =>
          void navigate('/dashboard/database/tables', { state: { slideFromStudio: true } })
        }
      />
      <div className="min-w-0 flex-1 flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--alpha-8)] bg-[rgb(var(--semantic-0))]">
          <div className="flex min-w-0 flex-1 items-center overflow-hidden pl-4 pr-3 py-3">
            <h1 className="shrink-0 text-base font-medium leading-7 text-foreground">
              Database Templates
            </h1>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1024px] px-6 py-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              {DATABASE_TEMPLATES.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onClick={() => handleTemplateClick(template)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
