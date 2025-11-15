import { useNavigate } from 'react-router-dom';
import { DATABASE_TEMPLATES, type DatabaseTemplate } from '@/features/database/templates';
import { useSQLEditorContext } from '@/features/database/contexts/SQLEditorContext';
import { TemplateCard } from '@/features/database/components/TemplateCard';

export default function TemplatesPage() {
  const navigate = useNavigate();
  const { addTab } = useSQLEditorContext();

  const handleTemplateClick = (template: DatabaseTemplate) => {
    // Create a new tab with the template's SQL query prefilled
    addTab(template.sql, template.title);
    // Navigate to the SQL Editor page
    void navigate('/dashboard/database/sql-editor');
  };

  return (
    <div className="flex flex-col h-full items-center bg-bg-gray dark:bg-neutral-800 overflow-auto">
      {/* Main Content - Centered */}
      <div className="flex flex-col max-w-[1024px] justify-center px-6 pb-6">
        {/* Header */}
        <div className="flex items-center justify-start gap-3 h-[72px] bg-bg-gray dark:bg-neutral-800 flex-shrink-0">
          <h1 className="text-xl font-semibold text-zinc-950 dark:text-white">Database Template</h1>
        </div>
        <div className="w-full max-w-[1024px]">
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-6">
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
  );
}
