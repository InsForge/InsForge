import { useNavigate } from 'react-router-dom';
import { DATABASE_TEMPLATES, type DatabaseTemplate } from '@/features/database/templates';
import { useSQLEditorContext } from '@/features/database/contexts/SQLEditorContext';

interface TemplateCardProps {
  template: DatabaseTemplate;
  onClick: () => void;
}

function TemplateCard({ template, onClick }: TemplateCardProps) {
  return (
    <button
      onClick={onClick}
      className="bg-white dark:bg-[#363636] border border-gray-200 dark:border-[#414141] rounded-[4px] px-6 py-4 text-left transition-colors hover:bg-gray-50 hover:border-gray-300 dark:hover:bg-neutral-700 dark:hover:border-[#525252] hover:shadow-sm"
    >
      <div className="flex flex-col gap-2">
        <h3 className="text-base font-normal text-zinc-950 dark:text-white leading-6">
          {template.title}
        </h3>
        <p className="text-sm font-normal text-zinc-500 dark:text-neutral-400 leading-6">
          {template.description}
        </p>
      </div>
    </button>
  );
}

export default function TemplatesPage() {
  const navigate = useNavigate();
  const { setQuery } = useSQLEditorContext();

  const handleTemplateClick = (template: DatabaseTemplate) => {
    // Set the query in the context so it persists to the SQL Editor page
    setQuery(template.sql);
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
          {/* Grid Layout with 3 columns */}
          <div className="grid grid-cols-3 gap-6">
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
