import { useNavigate } from 'react-router-dom';
import { DATABASE_TEMPLATES, type DatabaseTemplate } from '#features/database/templates';
import { useSQLEditorContext } from '#features/database/contexts/SQLEditorContext';
import { TemplateCard } from '#features/database/components/TemplateCard';
import { DatabaseStudioSidebarPanel } from '#features/database/components/DatabaseSidebar';

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
      <DatabaseStudioSidebarPanel
        onBack={() =>
          void navigate('/dashboard/database/tables', { state: { slideFromStudio: true } })
        }
      />
      <div className="min-w-0 flex-1 overflow-auto bg-[rgb(var(--semantic-1))]">
        <div className="mx-auto flex w-full max-w-[1024px] flex-col gap-6 px-4 pb-10 pt-8 sm:px-6 sm:pt-10 lg:px-10">
          <h1 className="text-2xl font-medium leading-8 text-foreground">Database Templates</h1>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {DATABASE_TEMPLATES.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onClick={() => handleTemplateClick(template)}
                showTableCount
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
