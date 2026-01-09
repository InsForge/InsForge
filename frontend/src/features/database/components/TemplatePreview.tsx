import { Button } from '@/components/radix/Button';
import { DatabaseTemplate } from '@/features/database/templates';
import { SchemaVisualizer } from '@/features/visualizer/components/SchemaVisualizer';
import { useRawSQL } from '@/features/database/hooks/useRawSQL';

interface TemplatePreviewProps {
  template: DatabaseTemplate;
  onCancel: () => void;
}

export function TemplatePreview({ template, onCancel }: TemplatePreviewProps) {
  const { executeSQL, isPending } = useRawSQL({
    showSuccessToast: true,
    showErrorToast: true,
    onSuccess: () => {
      // Close preview after successful implementation
      onCancel();
    },
  });

  const handleImplementTemplate = () => {
    executeSQL({ query: template.sql });
  };

  return (
    <div className="flex flex-col h-full bg-bg-gray dark:bg-neutral-800">
      {/* Top Bar */}
      <div className="flex items-center justify-center gap-3 h-12 px-4 border-b border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800">
        <p className="text-sm font-normal text-zinc-600 dark:text-neutral-400">
          You are previewing a template
        </p>
        <Button
          variant="outline"
          onClick={onCancel}
          className="h-8 px-4 dark:bg-neutral-600 dark:text-zinc-300 dark:border-neutral-600 dark:hover:bg-neutral-700"
        >
          Cancel
        </Button>
        <Button
          className="h-8 px-4 font-medium bg-emerald-300 hover:bg-emerald-400 text-black dark:bg-emerald-300 dark:hover:bg-emerald-400"
          onClick={handleImplementTemplate}
          disabled={isPending}
        >
          {isPending ? 'Implementing...' : 'Implement Template'}
        </Button>
      </div>

      {/* Visualizer Content */}
      <div className="relative flex-1 overflow-hidden">
        {/* Dot Matrix Background - Light Mode */}
        <div
          className="absolute inset-0 opacity-50 dark:hidden"
          style={{
            backgroundImage: `radial-gradient(circle, #D1D5DB 1px, transparent 1px)`,
            backgroundSize: '12px 12px',
          }}
        />
        {/* Dot Matrix Background - Dark Mode */}
        <div
          className="absolute inset-0 opacity-50 hidden dark:block"
          style={{
            backgroundImage: `radial-gradient(circle, #3B3B3B 1px, transparent 1px)`,
            backgroundSize: '12px 12px',
          }}
        />

        {/* SchemaVisualizer */}
        <div className="relative z-10 w-full h-full">
          <SchemaVisualizer
            externalSchemas={template.visualizerSchema}
            metadata={{
              auth: {
                providers: [],
              },
              database: {
                tables: [],
                totalSizeInGB: 0,
              },
              storage: {
                buckets: [],
                totalSizeInGB: 0,
              },
            }}
            showControls={false}
            showMiniMap={false}
          />
        </div>
      </div>
    </div>
  );
}
