import { cn } from '@/lib/utils/utils';
import { useFunctions } from '../hooks/useFunctions';

interface FunctionsSidebarProps {
  selectedSection: 'functions' | 'secrets' | 'cronjobs';
  onSectionSelect: (section: 'functions' | 'secrets' | 'cronjobs') => void;
}

export function FunctionsSidebar({ selectedSection, onSectionSelect }: FunctionsSidebarProps) {
  const { clearSelection } = useFunctions();
  const sections = [
    {
      id: 'functions' as const,
      name: 'Functions',
    },
    {
      id: 'cronjobs' as const,
      name: 'Cron Jobs',
    },
    {
      id: 'secrets' as const,
      name: 'Secrets',
    },
  ];

  return (
    <div className="w-60 px-3 py-4 flex flex-col h-full bg-white dark:bg-neutral-800 border-r border-border-gray dark:border-neutral-700">
      <div className="mb-4 w-full">
        <p className="text-base font-bold text-zinc-950 dark:text-white">Edge Functions</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-2">
          {sections.map((section) => {
            const isSelected = selectedSection === section.id;

            return (
              <button
                key={section.id}
                onClick={() => {
                  if (section.id === 'functions') {
                    clearSelection();
                  }
                  onSectionSelect(section.id);
                }}
                className={cn(
                  'h-9 w-full flex items-center justify-between pl-3 py-1 pr-1 rounded text-left transition-colors',
                  isSelected
                    ? 'bg-zinc-100 dark:bg-neutral-700 text-zinc-950 dark:text-white'
                    : 'hover:bg-zinc-50 dark:hover:bg-neutral-700/50 text-zinc-700 dark:text-zinc-300'
                )}
              >
                <p className="text-sm text-zinc-950 dark:text-white">{section.name}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
